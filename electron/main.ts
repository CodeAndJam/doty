import fs from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Worker as NodeWorker } from 'node:worker_threads'
import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron'
import {
  feedChunk,
  finalizeStream,
  freeRecognizer,
  initRecognizer,
  restartRecognizer,
  setOnAsrStatus,
  setOnFlushText,
  setOnInterimText,
  setOnParagraphBreak,
  startStream,
} from './asr'
import {
  coversLanguage,
  installRankerArchive,
  isRankerInstalled,
  RANKER_URL,
  rankerLanguages,
  rankerPaths,
} from './d1-model'
import { MOODS } from './d1-omni'
import {
  closeDb,
  getAllTags,
  getDb,
  getPlayFrequencies,
  getTags,
  getTagsMap,
  getTopPlayed,
  recordPlay,
  setTags,
} from './database'
import {
  clearToken,
  destroyDiscord,
  connect as discordConnect,
  disconnect as discordDisconnect,
  getState as discordGetState,
  getAutoConnect,
  getDiscordVolume,
  getGuilds,
  getVoiceChannels,
  joinChannel,
  leaveChannel,
  loadToken,
  onStateChange,
  pauseStream,
  resumeStream,
  setAutoConnect,
  setDiscordVolume,
  stopSfx,
  stopStream,
  streamSfx,
  streamTrack,
  tryAutoConnect,
} from './discord'
import { downloadFile } from './download-file'
import { EVENTS, type EventChannel, INVOKE, type InvokeChannel } from './ipc'
import { migrateFromJson } from './metadata-cache'
import { createModelDownloads } from './model-downloads'
import {
  DEFAULT_STT_LANGUAGE,
  DEFAULT_STT_MODEL,
  isAnySttModelReady,
  MODELS_DIR,
  STT_MODELS,
  type SttModelInfo,
  type SttModelType,
} from './model-paths'
import { getMusicFiles } from './music-library'
import { handleMusicRequest } from './music-protocol'
import { decide, disposeRanker, evaluateSession, setOnRankerStatus } from './ranker'
import { getAllMetadata, setOnLibraryChanged, startScanner, stopScanner } from './scanner'
import { planStep } from './session/director'
import { EMBEDDING_MODEL, embedderAvailable, loadEmbedder } from './session/embedder'
import { topK } from './session/embedding'
import { createIndexer } from './session/indexer'
import { learnedPick } from './session/preferences'
import type { Scene } from './session/scene'
import { createSessionStore } from './session/store'
import * as sessionOps from './sessions'
import { listSfx } from './sfx-library'
import { store } from './store'
import { resolveLanguage } from './stt-language'
import { updateWavHeader } from './wav-header'

// ponytail: no aux models needed — transcribe-cpp handles everything in one GGUF

/** Whether the selected model accepts a focused language (or auto-detect). */
function supportsLanguage(model: SttModelInfo | undefined, language: string): boolean {
  if (language === 'auto') return true
  // Base-aware: Parakeet Ultra advertises `pt`, the focused language is `pt-PT`.
  return resolveLanguage(language, model?.languages ?? []) !== undefined
}

// dlopen cannot read inside app.asar, so packaged builds must load the native
// bundle electron-builder unpacks to Resources/transcribe-cpp instead.
if (app.isPackaged) {
  const lib =
    process.platform === 'darwin'
      ? 'libtranscribe.dylib'
      : process.platform === 'win32'
        ? 'transcribe.dll'
        : 'libtranscribe.so'
  process.env.TRANSCRIBE_LIBRARY ??= join(process.resourcesPath, 'transcribe-cpp', lib)
}

let rankerDownloading = false

const rankerDownloads = createModelDownloads({
  download: downloadFile,
  onEvent: (event) => {
    if (event.type === 'progress') {
      send(EVENTS.rankerDownloadProgress, { percent: event.percent, status: 'downloading' })
    } else if (event.type === 'error') {
      rankerDownloading = false
      send(EVENTS.rankerDownloadProgress, { percent: 0, status: 'error' })
      console.error('[ranker] download failed:', event.error)
    }
  },
})

/**
 * Fetch the ranker once. The graph, manifest and tokenizer arrive as one
 * archive, so a partial download is never mistaken for an installed model:
 * nothing lands in the models dir until the checksum passes.
 */
async function downloadRanker(): Promise<{ ok: boolean; reason?: string }> {
  if (isRankerInstalled()) return { ok: true }
  if (rankerDownloading) return { ok: false, reason: 'already downloading' }

  rankerDownloading = true
  const { archive } = rankerPaths()
  try {
    const result = await rankerDownloads.start({ id: 'ranker', url: RANKER_URL }, archive)
    if (!result.ok) {
      rankerDownloading = false
      return result
    }
    installRankerArchive(archive)
    rankerDownloading = false
    send(EVENTS.rankerDownloadProgress, { percent: 100, status: 'done' })
    // Warm the fresh graph so the first prompt is not the first load.
    decide('', []).catch((e) => console.error('[ranker] warmup after download failed:', e))
    return { ok: true }
  } catch (e) {
    rankerDownloading = false
    fs.rmSync(archive, { force: true })
    const reason = e instanceof Error ? e.message : String(e)
    console.error('[ranker] install failed:', reason)
    send(EVENTS.rankerDownloadProgress, { percent: 0, status: 'error' })
    return { ok: false, reason }
  }
}

// Register app:// as a privileged scheme BEFORE app is ready.
// This makes the renderer a secure context (like https://) so the Cache API
// is available — transformers.js uses it to cache model weights between launches.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'music', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

/** True when the path is inside the configured music or SFX folder. */
function isAllowedMediaPath(filePath: string): boolean {
  const roots = [store.get('musicFolder', ''), store.get('sfxFolder', '')]
    .filter(Boolean)
    .map((root) => resolve(root as string))
  const resolved = resolve(filePath)
  return roots.some((root) => resolved === root || resolved.startsWith(root + sep))
}

let mainWindow: BrowserWindow | null = null

// Typed wrappers: a channel that is not declared in ipc.ts does not compile.
const handle = (channel: InvokeChannel, listener: Parameters<typeof ipcMain.handle>[1]) =>
  ipcMain.handle(channel, listener)

const send = (channel: EventChannel, payload?: unknown) => mainWindow?.webContents.send(channel, payload)

const sttDownloads = createModelDownloads({
  download: downloadFile,
  onEvent: (event) => {
    if (event.type === 'progress') {
      send(EVENTS.modelProgress, {
        modelId: event.modelId,
        percent: event.percent,
        downloadedMB: event.downloadedMB,
        totalMB: event.totalMB,
      })
    } else if (event.type === 'done') {
      send(EVENTS.modelStatus, { ready: true })
    } else if (event.type === 'cancelled') {
      send(EVENTS.modelDownloadCancelled, { modelId: event.modelId })
    } else {
      send(EVENTS.modelDownloadError, { modelId: event.modelId, error: event.error })
    }
  },
})

let sessionStartTime: number | null = null
/** True between stt:start and stt:stop (sessionStartTime may outlive a stop for trailing flushes). */
let recordingActive = false
let sessionWavFd: number | null = null
let sessionWavBytes = 0
let wavHeaderInterval: ReturnType<typeof setInterval> | null = null

function getActiveSessionFile(): string | null {
  const active = sessionOps.getActiveSession()
  if (active && sessionOps.isSessionPath(active)) return active
  const last = sessionOps.getLastSession()
  if (last && sessionOps.isSessionPath(last)) return last
  return null
}

function getSessionWavPath(): string | null {
  const vtt = getActiveSessionFile()
  if (!vtt) return null
  return vtt.replace(/\.vtt$/, '.wav')
}

function startWavRecording(): void {
  const wavPath = getSessionWavPath()
  if (!wavPath) return
  // Close any previous take before reopening (record/stop in the same session appends)
  finalizeWavRecording()
  let existingBytes = 0
  try {
    const stat = fs.statSync(wavPath)
    const fd = fs.openSync(wavPath, 'r')
    const magic = Buffer.alloc(4)
    fs.readSync(fd, magic, 0, 4, 0)
    fs.closeSync(fd)
    if (stat.size >= 44 && magic.toString() === 'RIFF') existingBytes = stat.size - 44
  } catch {
    /* new file */
  }
  if (existingBytes === 0) {
    // Write a placeholder 44-byte WAV header (updated on stop)
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(0, 4) // placeholder file size
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16) // PCM format chunk size
    header.writeUInt16LE(1, 20) // PCM format
    header.writeUInt16LE(1, 22) // mono
    header.writeUInt32LE(16000, 24) // sample rate
    header.writeUInt32LE(32000, 28) // byte rate (16000 * 2)
    header.writeUInt16LE(2, 32) // block align
    header.writeUInt16LE(16, 34) // bits per sample
    header.write('data', 36)
    header.writeUInt32LE(0, 40) // placeholder data size
    fs.writeFileSync(wavPath, header)
  }
  sessionWavFd = fs.openSync(wavPath, 'r+')
  sessionWavBytes = existingBytes
  // Update WAV header every 30s for crash resilience
  wavHeaderInterval = setInterval(() => {
    if (sessionWavFd !== null) updateWavHeader(sessionWavFd, sessionWavBytes)
  }, 30000)
}

function appendWavChunk(samples: Float32Array): void {
  if (sessionWavFd === null) return
  const int16 = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    int16.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768))), i * 2)
  }
  // Write at an explicit offset: appendFileSync on an fd starts at position 0 and
  // would overwrite the 44-byte WAV header.
  fs.writeSync(sessionWavFd, int16, 0, int16.length, 44 + sessionWavBytes)
  sessionWavBytes += int16.length
}

function finalizeWavRecording(): void {
  if (wavHeaderInterval) {
    clearInterval(wavHeaderInterval)
    wavHeaderInterval = null
  }
  if (sessionWavFd === null) return
  // Update RIFF size and data size in the header
  updateWavHeader(sessionWavFd, sessionWavBytes)
  fs.closeSync(sessionWavFd)
  sessionWavFd = null
  sessionWavBytes = 0
}

function launchScanner(folder: string, force = false) {
  startScanner(
    folder,
    (done, total, current) => {
      send(EVENTS.scanProgress, { done, total, current })
    },
    () => {
      send(EVENTS.scanComplete)
    },
    force,
  )
}

/** Watcher removals can arrive in bursts — sync the library once they settle. */
let librarySyncTimer: ReturnType<typeof setTimeout> | null = null
setOnLibraryChanged(() => {
  if (librarySyncTimer) clearTimeout(librarySyncTimer)
  librarySyncTimer = setTimeout(() => {
    librarySyncTimer = null
    send(EVENTS.scanComplete)
  }, 500)
})

function registerAppProtocol() {
  const rendererRoot = join(__dirname, '../renderer')
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    const filePath = join(rendererRoot, url.pathname === '/' ? 'index.html' : url.pathname)
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function createWindow() {
  const iconPath = app.isPackaged ? join(process.resourcesPath, 'icon.icns') : join(__dirname, '../../build/icon.png')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0f13',
    titleBarStyle: 'hiddenInset',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadURL('app://doty/')
  }

  // Async callbacks keep using mainWindow; clear it so sends after close are no-ops
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerMusicProtocol() {
  protocol.handle('music', (request) => {
    try {
      return handleMusicRequest(
        { url: request.url, rangeHeader: request.headers.get('Range') },
        {
          musicFolder: store.get('musicFolder', '') as string,
          sfxFolder: store.get('sfxFolder', '') as string,
        },
      )
    } catch (err) {
      console.error('[music-protocol] unhandled error:', err)
      return new Response('Internal error', { status: 500 })
    }
  })
}

app.whenReady().then(async () => {
  // Set dock icon in dev mode (in production it comes from the .app bundle)
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = join(__dirname, '../../build/icon.png')
    if (fs.existsSync(iconPath)) {
      app.dock.setIcon(iconPath)
    }
  }

  // Initialize SQLite database and migrate legacy JSON cache
  getDb()
  migrateFromJson()

  registerAppProtocol()
  registerMusicProtocol()
  createWindow()

  // Forward Discord state changes to renderer. Registered first: anything that
  // throws later in this callback used to skip it, which left the Discord panel
  // stuck on "disconnected" even when the bot had connected.
  onStateChange((discordState) => {
    send(EVENTS.discordState, discordState)
  })

  // Auto-connect to last Discord voice channel if enabled
  tryAutoConnect()

  const ready = isAnySttModelReady()
  send(EVENTS.modelStatus, { ready })

  // Always set up ASR callbacks (process starts lazily on first transcribe)
  setOnInterimText((text) => {
    send(EVENTS.sttInterim, text)
  })
  setOnAsrStatus((status) => {
    send(EVENTS.sttStatus, status)
  })
  setOnParagraphBreak(() => {
    send(EVENTS.paragraphBreak)
  })

  // ── Transcript wiring ────────────────────────────────────────────────────
  setOnFlushText((text, elapsedMs) => {
    const file = getActiveSessionFile()
    let elapsed = elapsedMs
    if (file) {
      if (!sessionStartTime) sessionStartTime = Date.now()
      elapsed = Date.now() - sessionStartTime
      sessionOps.appendCue(file, elapsed, text)
    }
    // Send the same time base used for the saved VTT cues
    send(EVENTS.transcript, { text, elapsedMs: elapsed })
  })

  setOnRankerStatus((status) => {
    send(EVENTS.rankerStatus, status)
  })

  if (ready) {
    // Init ASR immediately — transcribe-cpp loads in ~160ms
    try {
      initRecognizer()
    } catch (e) {
      console.error('ASR init error:', e)
    }
  }

  const musicFolder = store.get('musicFolder', '') as string
  if (musicFolder) {
    launchScanner(musicFolder)
    // Minutes of work, so it runs in the background and resumes next launch.
    setTimeout(() => startIndexing(musicFolder).catch(() => {}), 3_000)
  }

  // One background download, once per machine. No prompt: the app is useless
  // without it, and 1.5 GB of silence during a session would be worse.
  if (!isRankerInstalled()) {
    downloadRanker().catch((e) => console.error('[ranker] background download failed:', e))
  }
})

app.on('before-quit', () => {
  finalizeWavRecording()
  freeRecognizer()
  disposeRanker()
  stopScanner()
  closeDb()
  destroyDiscord()
})

app.on('window-all-closed', () => {
  freeRecognizer()
  destroyDiscord()
  app.quit()
})

// ── IPC: Microphone Permission ────────────────────────────────────────────────

handle(INVOKE.micCheckPermission, () => {
  if (process.platform !== 'darwin') return 'granted'
  const { systemPreferences } = require('electron')
  return systemPreferences.getMediaAccessStatus('microphone')
})

handle(INVOKE.micRequestPermission, async () => {
  if (process.platform !== 'darwin') return true
  const { systemPreferences } = require('electron')
  return systemPreferences.askForMediaAccess('microphone')
})

handle(INVOKE.micOpenSettings, () => {
  const { shell } = require('electron')
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
})

// ── IPC: STT ──────────────────────────────────────────────────────────────────

handle(INVOKE.sttStart, () => {
  if (!isAnySttModelReady()) return { ok: false, reason: 'no-model' }
  // Continue timestamps after the active session's last cue instead of restarting at 0
  const activeFile = getActiveSessionFile()
  sessionStartTime = Date.now() - (activeFile ? sessionOps.getLastCueStartMs(activeFile) : 0)
  recordingActive = true
  startWavRecording()
  startStream()
  return { ok: true }
})
handle(INVOKE.sttStop, () => {
  finalizeStream()
  finalizeWavRecording()
  recordingActive = false
  return { ok: true }
})

// Renderer sends PCM segments as Float32Array buffers.
// In streaming mode, feeds chunks to the active stream.
// Results come back via 'stt:transcript' and 'stt:interim' events.
handle(INVOKE.sttTranscribeChunk, async (_e, buffer: ArrayBuffer) => {
  try {
    const samples = new Float32Array(buffer)
    appendWavChunk(samples)
    feedChunk(samples)
    return { text: '' } // text delivered via events
  } catch (e) {
    console.error('Transcribe error:', e)
    return { text: '' }
  }
})

// ── IPC: Music ────────────────────────────────────────────────────────────────

handle(INVOKE.setMusicFolder, (_e, folderPath: string) => {
  store.set('musicFolder', folderPath)
  launchScanner(folderPath)
  send(EVENTS.musicFolderChanged, folderPath)
  return { ok: true }
})

handle(INVOKE.getMusicFolder, () => store.get('musicFolder', ''))

handle(INVOKE.pickMusicFolder, async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Music Folder',
  })
  if (!result.canceled && result.filePaths[0]) {
    store.set('musicFolder', result.filePaths[0])
    launchScanner(result.filePaths[0])
    send(EVENTS.musicFolderChanged, result.filePaths[0])
    return result.filePaths[0]
  }
  return null
})

handle(INVOKE.listMusic, () => {
  const musicFolder = store.get('musicFolder', '') as string
  if (!musicFolder) return []
  return getMusicFiles(musicFolder)
})

handle(INVOKE.triggerScan, () => {
  const musicFolder = store.get('musicFolder', '') as string
  if (!musicFolder) return { ok: false }
  launchScanner(musicFolder, true)
  return { ok: true }
})

handle(INVOKE.getAllMetadata, () => {
  return getAllMetadata()
})

// ── IPC: Tags ─────────────────────────────────────────────────────────────────

handle(INVOKE.getTags, (_e, filename: string) => getTags(filename))

handle(INVOKE.setTags, (_e, filename: string, tags: string[]) => {
  setTags(filename, tags)
  return { ok: true }
})

handle(INVOKE.getAllTags, () => getAllTags())

handle(INVOKE.getTagsMap, () => getTagsMap())

// ── IPC: Play History ─────────────────────────────────────────────────────────

handle(INVOKE.recordPlay, (_e, itemId: string, itemType: 'music' | 'sfx') => {
  recordPlay(itemId, itemType)
  return { ok: true }
})

handle(INVOKE.getPlayFrequencies, (_e, itemType: 'music' | 'sfx') => {
  return getPlayFrequencies(itemType)
})

handle(INVOKE.getTopPlayed, (_e, itemType: 'music' | 'sfx', limit?: number) => {
  return getTopPlayed(itemType, limit)
})

// ── IPC: Transcripts ──────────────────────────────────────────────────────────

handle(INVOKE.getTranscriptFolder, () => store.get('transcriptFolder', ''))

handle(INVOKE.pickTranscriptFolder, async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Transcript Folder',
  })
  if (!result.canceled && result.filePaths[0]) {
    const folder = result.filePaths[0]
    const previous = store.get('transcriptFolder', '') as string
    if (folder !== previous) {
      // Old session paths are outside the new vault — start a fresh session there
      finalizeWavRecording()
      store.set('transcriptFolder', folder)
      sessionOps.createSession()
      if (recordingActive) {
        sessionStartTime = Date.now()
        startWavRecording()
      }
      send(EVENTS.sessionsChanged)
    }
    return folder
  }
  return null
})

handle(INVOKE.saveTranscript, (_e, text: string) => {
  const folder = store.get('transcriptFolder', '') as string
  if (!folder) return { ok: false, reason: 'no folder set' }
  try {
    fs.mkdirSync(folder, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const file = join(folder, `transcript-${ts}.txt`)
    fs.writeFileSync(file, text, 'utf-8')
    return { ok: true, file }
  } catch (e) {
    return { ok: false, reason: String(e) }
  }
})

// ── IPC: Sessions ─────────────────────────────────────────────────────────────

handle(INVOKE.sessionCreate, (_e, name?: string) => {
  const session = sessionOps.createSession(name)
  if (recordingActive) {
    // Recording in progress — start a fresh take in the new session
    finalizeWavRecording()
    sessionStartTime = Date.now()
    startWavRecording()
  }
  return session
})

handle(INVOKE.sessionList, () => {
  return sessionOps.listSessions()
})

handle(INVOKE.sessionLoad, async (_e, file: string) => {
  if (!sessionOps.isSessionPath(file)) return []
  sessionOps.setLastSession(file)
  return sessionOps.loadSessionAsync(file)
})

handle(INVOKE.sessionSetActive, (_e, file: string) => {
  if (!sessionOps.isSessionPath(file)) return { ok: false }
  sessionOps.setActiveSession(file)
  if (recordingActive) {
    // Recording in progress — keep cues monotonic and route audio to the new session
    finalizeWavRecording()
    sessionStartTime = Date.now() - sessionOps.getLastCueStartMs(file)
    startWavRecording()
  }
  return { ok: true }
})

handle(INVOKE.sessionRename, (_e, file: string, newName: string) => {
  if (!sessionOps.isSessionPath(file)) return
  sessionOps.renameSession(file, newName)
})

handle(INVOKE.sessionDelete, (_e, file: string) => {
  if (!sessionOps.isSessionPath(file)) return { ok: false }
  const wasActive = getActiveSessionFile() === file
  if (wasActive && sessionWavFd !== null) finalizeWavRecording()
  sessionOps.deleteSession(file)
  if (wasActive) {
    const next = sessionOps.listSessions()[0]?.file ?? null
    sessionOps.setLastSession(next ?? '')
    sessionOps.setActiveSession(next)
    if (recordingActive) {
      // Still recording — continue the take in the next session if there is one
      sessionStartTime = Date.now() - (next ? sessionOps.getLastCueStartMs(next) : 0)
      startWavRecording()
    }
  }
  return { ok: true }
})

handle(INVOKE.sessionGetLast, () => {
  return sessionOps.getLastSession()
})

// ── IPC: Reprocess (TODO: rewrite for transcribe-cpp batch mode) ──────────────

let reprocessWorker: NodeWorker | null = null

handle(INVOKE.reprocessStart, (_e, _sessionFile: string, _modelId: string) => {
  // ponytail: reprocess needs rewrite for transcribe-cpp. Stub for now.
  return { ok: false, reason: 'Reprocess not yet available with new STT engine' }
})

handle(INVOKE.reprocessCancel, () => {
  if (reprocessWorker) {
    reprocessWorker.terminate()
    reprocessWorker = null
  }
  return { ok: true }
})

// ── IPC: Model download ───────────────────────────────────────────────────────

// isAnySttModelReady imported from model-paths

handle(INVOKE.modelStatus, () => ({
  ready: isAnySttModelReady(),
  onboardingSkipped: store.get('sttOnboardingSkipped', false),
}))

handle(INVOKE.rankerStatus, () => ({
  cached: isRankerInstalled(),
  downloading: rankerDownloading,
  languageCovered: coversLanguage(rankerLanguages(), store.get('sttLanguage', DEFAULT_STT_LANGUAGE) as string),
}))

handle(INVOKE.rankerDownload, () => downloadRanker())

const sessionStore = createSessionStore(getDb())

let liveScene: Scene | null = null
let lastChangeAt = 0
let lastLoggedAt = 0
/** One session pass at a time: two in flight would race the scene and the clock. */
let sessionPipeline: Promise<unknown> = Promise.resolve()

handle(
  INVOKE.sessionEvaluate,
  async (
    _e,
    request: {
      state: string
      candidates: string[]
      paths: string[]
      msUntilTrackEnd: number | null
      autopilot: boolean
      override: boolean
    },
  ) => {
    const run = sessionPipeline.then(async () => {
      const { tracks, moods } = await evaluateSession(request.state, request.candidates)
      if (moods.length === 0) return { tracks, moods, plan: null }

      let best = 0
      for (let i = 1; i < moods.length; i++) if (moods[i] > moods[best]) best = i
      const now = Date.now()

      // Where the model cannot decide, prefer what the DM chose for this scene.
      const learned = learnedPick({
        probabilities: tracks,
        paths: request.paths,
        preferences: sessionStore.recentPreferences(200),
        scene: liveScene?.mood ?? MOODS[best] ?? null,
      })
      // The learned pick changes *which* track, never the probability: rewriting
      // the numbers would fake a confidence the model never had.
      const pickIndex = learned ? request.paths.indexOf(learned.path) : tracks.indexOf(Math.max(...tracks))
      const step = planStep({
        previous: liveScene,
        observation: {
          mood: MOODS[best] ?? 'exploration',
          intensity: 0.5,
          moodProbability: moods[best] ?? 0,
          trackProbability: tracks.length > 0 ? Math.max(...tracks) : 0,
        },
        now,
        msUntilTrackEnd: request.msUntilTrackEnd,
        msSinceLastChange: now - lastChangeAt,
        autopilot: request.autopilot,
        override: request.override,
      })

      const sceneMoved = liveScene === null || step.scene.mood !== liveScene.mood
      if (sceneMoved) {
        sessionStore.recordScene({
          session: 'live',
          mood: step.scene.mood,
          intensity: step.scene.intensity,
          startedAt: step.scene.since,
        })
      }
      // The clock gates the change cooldown, so it only moves when music would.
      if (step.action.kind !== 'hold') lastChangeAt = now
      liveScene = step.scene

      // Holds are main's to log (throttled: one per half minute). Actions are logged
      // by the renderer once it has actually executed them, so `autoActions` counts
      // changes that happened rather than changes that were proposed.
      if (step.action.kind === 'hold' && now - lastLoggedAt > 30_000) {
        lastLoggedAt = now
        sessionStore.recordDecision({
          at: now,
          kind: 'music',
          action: step.action.kind,
          reason: step.action.reason,
          track: best >= 0 ? (request.paths[best] ?? null) : null,
          probability: best >= 0 ? (tracks[best] ?? 0) : 0,
          mood: step.scene.mood,
          source: 'auto',
        })
      }

      return {
        tracks,
        moods,
        plan: {
          scene: step.scene.mood,
          action: step.action.kind,
          reason: step.action.reason,
          track: tracks.length > 0 ? (request.paths[tracks.indexOf(Math.max(...tracks))] ?? null) : null,
        },
      }
    })
    sessionPipeline = run.catch(() => {})
    return run
  },
)
handle(INVOKE.sessionDecision, (_e, row: Parameters<typeof sessionStore.recordDecision>[0]) => {
  sessionStore.recordDecision(row)
  return { ok: true }
})
handle(INVOKE.sessionPreference, (_e, row: Parameters<typeof sessionStore.recordPreference>[0]) => {
  sessionStore.recordPreference(row)
  return { ok: true }
})
handle(INVOKE.sessionReport, (_e, since: number) => sessionStore.report(since))

// ── Embeddings: indexed in the background, used when they exist ───────────────
const EMBEDDER_DIR = join(MODELS_DIR, 'embeddinggemma-300m')
let embedder: Awaited<ReturnType<typeof loadEmbedder>> | null = null
let embedding: { done: number; total: number } = { done: 0, total: 0 }
let indexing = false

/** Load the model and index whatever is missing, in batches, without blocking. */
async function startIndexing(folder: string): Promise<void> {
  if (indexing || !embedderAvailable(EMBEDDER_DIR)) return
  indexing = true
  try {
    embedder ??= await loadEmbedder(EMBEDDER_DIR)
    const files = getMusicFiles(folder)
    embedding = { done: 0, total: files.length }
    const indexer = createIndexer({
      paths: () => files,
      store: sessionStore,
      embed: (texts) => embedder!.embed(texts),
      model: EMBEDDING_MODEL,
      // The folder path is most of what the model needs to know about a track:
      // "Combat/Boss/The Enemy" says more than any tag we could invent.
      describe: (path) => path.replace(/\.[^.]+$/, '').replace(/[-_/]/g, ' '),
      batch: 8,
      onProgress: (p) => {
        embedding = p
        send(EVENTS.embeddingProgress, p)
      },
    })
    await indexer.run()
  } catch (e) {
    console.error('[embedding] indexing failed:', e)
  } finally {
    indexing = false
  }
}

handle(INVOKE.embeddingStatus, () => {
  const folder = store.get('musicFolder', '') as string
  const total = folder ? getMusicFiles(folder).length : 0
  return { ready: embedder !== null, indexed: embedding.done, total }
})

handle(INVOKE.similarTracks, async (_e, text: string, k: number) => {
  if (!embedder || !text.trim()) return []
  try {
    const [query] = await embedder.embed([text])
    const vectors = new Map<string, Float32Array>()
    for (const path of getMusicFiles(store.get('musicFolder', '') as string)) {
      const vector = sessionStore.getVector(path, EMBEDDING_MODEL)
      if (vector) vectors.set(path, vector)
    }
    return topK(query, vectors, Math.max(1, Math.min(k, 50)))
  } catch (e) {
    console.error('[embedding] query failed:', e)
    return []
  }
})

handle(INVOKE.rankerDecide, async (_e, prompt: string, candidates: string[]) => {
  return decide(prompt, candidates)
})

handle(INVOKE.getRecommendationCount, () => store.get('recommendationCount', 5))

handle(INVOKE.setRecommendationCount, (_e, count: number) => {
  store.set('recommendationCount', Math.max(1, Math.min(20, Math.round(count))))
  return { ok: true }
})

// ── IPC: Model downloads ──────────────────────────────────────────────────────

handle(INVOKE.downloadModel, async (_e, modelId?: SttModelType) => {
  const modelInfo = modelId
    ? (STT_MODELS.find((m) => m.id === modelId) ?? STT_MODELS[0])
    : (STT_MODELS.find((m) => m.id === DEFAULT_STT_MODEL) ?? STT_MODELS[0])

  if (modelInfo.isReady()) {
    store.set('sttModel', modelInfo.id)
    restartRecognizer()
    send(EVENTS.modelStatus, { ready: true })
    return { ok: true }
  }

  const result = await sttDownloads.start(
    { id: modelInfo.id, url: modelInfo.url },
    join(MODELS_DIR, modelInfo.ggufFile),
  )
  if (!result.ok) return result

  store.set('sttModel', modelInfo.id)
  // The file is complete and selected: report success even if a local model
  // fails to initialise, otherwise the UI claims the download failed.
  try {
    restartRecognizer()
  } catch (err) {
    console.error('[model] post-download init error:', err)
  }
  return { ok: true }
})

handle(INVOKE.getSttDownloadState, () => sttDownloads.state())

handle(INVOKE.cancelSttDownload, () => {
  sttDownloads.cancel()
  return { ok: true }
})

handle(INVOKE.skipModelOnboarding, () => {
  store.set('sttOnboardingSkipped', true)
  return { ok: true }
})

// ── IPC: STT Model Selection ─────────────────────────────────────────────────

handle(INVOKE.getSttModel, () => {
  return store.get('sttModel', DEFAULT_STT_MODEL) as string
})

handle(INVOKE.setSttModel, (_e, modelId: SttModelType) => {
  const current = store.get('sttModel', '') as string
  if (current === modelId) return { ok: true }
  const modelInfo = STT_MODELS.find((m) => m.id === modelId)
  if (!modelInfo) return { ok: false, reason: 'unknown model' }
  if (!modelInfo.isReady()) return { ok: false, reason: 'model not downloaded' }
  store.set('sttModel', modelId)
  // Keep the focused language only when the new model supports it.
  const language = store.get('sttLanguage', DEFAULT_STT_LANGUAGE) as string
  if (!supportsLanguage(modelInfo, language)) {
    store.set('sttLanguage', 'auto')
  }
  restartRecognizer()
  // Notify renderer about the switch
  send(EVENTS.sttModelSwitched, { id: modelId, label: modelInfo.label })
  return { ok: true }
})

handle(INVOKE.getSttLanguage, () => store.get('sttLanguage', DEFAULT_STT_LANGUAGE) as string)

handle(INVOKE.setSttLanguage, (_e, language: string) => {
  const modelId = store.get('sttModel', DEFAULT_STT_MODEL) as SttModelType
  const modelInfo = STT_MODELS.find((m) => m.id === modelId)
  if (!supportsLanguage(modelInfo, language)) {
    return { ok: false, reason: 'unsupported language' }
  }
  store.set('sttLanguage', language)
  restartRecognizer()
  return { ok: true }
})

handle(INVOKE.getSttModelStatus, () => {
  return Object.fromEntries(STT_MODELS.map((m) => [m.id, m.isReady()]))
})

/** Return the model registry for the renderer */
handle(INVOKE.getSttModelList, () => {
  return STT_MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    description: m.description,
    size: m.size,
    streaming: m.streaming,
    languages: m.languages,
    default: !!m.default,
    ready: m.isReady(),
  }))
})

// ── IPC: Discord ──────────────────────────────────────────────────────────────

handle(INVOKE.discordConnect, async (_e, token?: string) => {
  try {
    await discordConnect(token)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

handle(INVOKE.discordDisconnect, async () => {
  await discordDisconnect()
  return { ok: true }
})

handle(INVOKE.discordGetState, () => discordGetState())

handle(INVOKE.discordGetGuilds, () => getGuilds())

handle(INVOKE.discordGetVoiceChannels, (_e, guildId: string) => getVoiceChannels(guildId))

handle(INVOKE.discordJoinChannel, async (_e, guildId: string, channelId: string) => {
  try {
    await joinChannel(guildId, channelId)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

handle(INVOKE.discordLeaveChannel, () => {
  leaveChannel()
  return { ok: true }
})

handle(INVOKE.discordStreamTrack, (_e, filename: string, seekSeconds?: number) => {
  const musicFolder = store.get('musicFolder', '') as string
  if (!musicFolder) return { ok: false }
  const resolved = filename.startsWith('/') ? filename : join(musicFolder, filename)
  if (!isAllowedMediaPath(resolved)) return { ok: false }
  streamTrack(filename, seekSeconds ?? 0)
  return { ok: true }
})

handle(INVOKE.discordStreamSfx, (_e, absolutePath: string, volume?: number) => {
  if (!isAllowedMediaPath(absolutePath)) return { ok: false }
  streamSfx(absolutePath, volume)
  return { ok: true }
})

handle(INVOKE.discordStopStream, () => {
  stopStream()
  return { ok: true }
})

handle(INVOKE.discordStopSfx, (_e, absolutePath?: string) => {
  stopSfx(absolutePath)
  return { ok: true }
})

handle(INVOKE.discordPauseStream, () => {
  pauseStream()
  return { ok: true }
})

handle(INVOKE.discordResumeStream, () => {
  resumeStream()
  return { ok: true }
})

handle(INVOKE.discordSetVolume, (_e, volume: number) => {
  setDiscordVolume(volume)
  return { ok: true }
})

handle(INVOKE.discordGetVolume, () => getDiscordVolume())

handle(INVOKE.discordHasToken, () => {
  return loadToken() !== ''
})

handle(INVOKE.discordClearToken, () => {
  clearToken()
  return { ok: true }
})

handle(INVOKE.discordGetAutoConnect, () => getAutoConnect())

handle(INVOKE.discordSetAutoConnect, (_e, enabled: boolean) => {
  setAutoConnect(enabled)
  return { ok: true }
})

// ── IPC: SFX ─────────────────────────────────────────────────────────────────

handle(INVOKE.getSfxList, () => listSfx(store.get('sfxFolder', '') as string))

handle(INVOKE.getSfxFolder, () => store.get('sfxFolder', ''))

handle(INVOKE.pickSfxFolder, async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select SFX Folder',
  })
  if (!result.canceled && result.filePaths[0]) {
    store.set('sfxFolder', result.filePaths[0])
    send(EVENTS.sfxChanged)
    return result.filePaths[0]
  }
  return null
})

handle(INVOKE.setSfxFolder, (_e, folderPath: string) => {
  store.set('sfxFolder', folderPath)
  send(EVENTS.sfxChanged)
  return { ok: true }
})

handle(INVOKE.getSfxRecommendationCount, () => store.get('sfxRecommendationCount', 5))

handle(INVOKE.setSfxRecommendationCount, (_e, count: number) => {
  store.set('sfxRecommendationCount', Math.max(1, Math.min(10, Math.round(count))))
  return { ok: true }
})

// ── IPC: Autopilot (#12) ──────────────────────────────────────────────────────

handle(INVOKE.getAutopilotConfig, () => ({
  enabled: store.get('autopilotEnabled', false),
  musicEnabled: store.get('autopilotMusicEnabled', true),
  sfxEnabled: store.get('autopilotSfxEnabled', true),
  confidenceThreshold: store.get('autopilotConfidenceThreshold', 0.9),
  crossfadeDuration: store.get('autopilotCrossfadeDuration', 3),
  musicCooldownSeconds: store.get('autopilotMusicCooldown', 60),
  minPlaySeconds: store.get('autopilotMinPlaySeconds', 30),
  sfxPerEffectCooldownSeconds: store.get('autopilotSfxPerEffectCooldown', 30),
  sfxGlobalCooldownSeconds: store.get('autopilotSfxGlobalCooldown', 10),
  sfxAutoVolume: store.get('autopilotSfxAutoVolume', 0.7),
  recentlyPlayedMinutes: store.get('autopilotRecentlyPlayedMinutes', 10),
}))

handle(INVOKE.setAutopilotConfig, (_e, config: Record<string, unknown>) => {
  if (typeof config.enabled === 'boolean') store.set('autopilotEnabled', config.enabled)
  if (typeof config.musicEnabled === 'boolean') store.set('autopilotMusicEnabled', config.musicEnabled)
  if (typeof config.sfxEnabled === 'boolean') store.set('autopilotSfxEnabled', config.sfxEnabled)
  if (typeof config.confidenceThreshold === 'number')
    store.set('autopilotConfidenceThreshold', config.confidenceThreshold)
  if (typeof config.crossfadeDuration === 'number') store.set('autopilotCrossfadeDuration', config.crossfadeDuration)
  if (typeof config.musicCooldownSeconds === 'number') store.set('autopilotMusicCooldown', config.musicCooldownSeconds)
  if (typeof config.minPlaySeconds === 'number') store.set('autopilotMinPlaySeconds', config.minPlaySeconds)
  if (typeof config.sfxPerEffectCooldownSeconds === 'number')
    store.set('autopilotSfxPerEffectCooldown', config.sfxPerEffectCooldownSeconds)
  if (typeof config.sfxGlobalCooldownSeconds === 'number')
    store.set('autopilotSfxGlobalCooldown', config.sfxGlobalCooldownSeconds)
  if (typeof config.sfxAutoVolume === 'number') store.set('autopilotSfxAutoVolume', config.sfxAutoVolume)
  if (typeof config.recentlyPlayedMinutes === 'number')
    store.set('autopilotRecentlyPlayedMinutes', config.recentlyPlayedMinutes)
  return { ok: true }
})
