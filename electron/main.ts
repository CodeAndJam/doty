import fs from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Worker as NodeWorker } from 'node:worker_threads'
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { describeTrack } from '../src/lib/describeTrack'
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
  clearLaneOverride,
  closeDb,
  getAllTags,
  getDb,
  getLaneOverrides,
  getPlayFrequencies,
  getSfxDurations,
  getTags,
  getTagsMap,
  getTopPlayed,
  pruneMissingTracks,
  recordPlay,
  setLaneOverride,
  setSfxDuration,
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
  setDiscordVerbose,
  setDiscordVolume,
  stopSfx,
  stopStream,
  streamSfx,
  streamTrack,
  tryAutoConnect,
} from './discord'
import { ffmpegStatus } from './discord-audio'
import { downloadFile } from './download-file'
import { EVENTS, type EventChannel, INVOKE, type InvokeChannel } from './ipc'
import { createLibrary } from './library'
import { debugLogger, enableDebugLogging } from './logger'
import { migrateFromJson } from './metadata-cache'
import { createModelDownloads } from './model-downloads'
import {
  DEFAULT_STT_LANGUAGE,
  DEFAULT_STT_MODEL,
  isAnySttModelReady,
  MODELS_DIR,
  STT_MODELS,
  STT_SIDE_MODELS,
  type SttModelInfo,
  type SttModelType,
} from './model-paths'
import { getMusicFiles, invalidateMusicLibrary } from './music-library'
import { handleMusicRequest } from './music-protocol'
import { DOTY_HOME } from './profile'
import { decide, disposeRanker, evaluateSession, rankSfx, setOnRankerStatus } from './ranker'
import { getAllMetadata, setOnLibraryChanged, startScanner, stopScanner } from './scanner'
import { clipWindow, embedTrackAudio, loadKindAnchors } from './session/audio/track'
import { audioAvailable, embedderAvailable, loadEmbedder, RETRIEVAL_KEY } from './session/embedder'
import { type AudioKind, decideKindFor, disambiguate, moveDestination } from './session/kindDecision'
import { createSessionPass, type PassRequest } from './session/pass'
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

/** Set once the app is tearing down: sending then is how a quit becomes a crash. */
let quitting = false

const send = (channel: EventChannel, payload?: unknown) => {
  if (quitting || !mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

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
      // A scan is the only moment the library is known to be complete, so it is
      // also the moment to forget files that moved away.
      try {
        pruneMissingTracks(folder, getMusicFiles(folder))
      } catch (e) {
        console.error('[library] prune failed:', e)
      }
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

  // A recording that dies without `sttStop` must not leave the index paused for
  // the rest of the process. Resume after the new document is up — not on
  // navigation, which also fires during shutdown, after the database is closed.
  mainWindow.webContents.on('render-process-gone', () => library.resume())
  mainWindow.webContents.on('did-finish-load', () => library.resume())

  // Async callbacks keep using mainWindow; clear it so sends after close are no-ops
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Renderer errors used to exist only in DevTools; debug mode puts them in the
  // same log file as the main process.
  mainWindow.webContents.on('console-message', (event) => {
    if (!debugLogger.isEnabled()) return
    if (event.level !== 'warning' && event.level !== 'error') return
    debugLogger.write(event.level === 'error' ? 'error' : 'warn', [
      `[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})`,
    ])
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
  // Debug mode is a persisted choice; apply it before anything else logs.
  const debugOn = store.get('debugMode', false) ?? false
  enableDebugLogging(debugOn)
  setDiscordVerbose(debugOn)

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
    // The VAD model is small and transcription degrades without it. Fetch it in
    // the background when the ASR model is already present, not only when the DM
    // re-downloads a model they already have.
    void ensureSideModels().catch((e) => console.warn('[model] optional VAD not installed:', e))
  }

  const musicFolder = store.get('musicFolder', '') as string
  if (musicFolder) launchScanner(musicFolder)
  // Either folder is a source now, so either one is worth indexing at startup.
  if (musicFolder || store.get('sfxFolder', '')) startBackgroundPasses()

  // One background download, once per machine. No prompt: the app is useless
  // without it, and 1.5 GB of silence during a session would be worse.
  if (!isRankerInstalled()) {
    downloadRanker().catch((e) => console.error('[ranker] background download failed:', e))
  }
})

app.on('before-quit', () => {
  // Before the database closes: nothing may emit status after that point.
  quitting = true
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
  // The index is minutes of model work; the transcript is the critical path.
  library.pause()
  startWavRecording()
  startStream()
  return { ok: true }
})
handle(INVOKE.sttStop, () => {
  finalizeStream()
  finalizeWavRecording()
  recordingActive = false
  library.resume()
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

/**
 * Move one file between the music library and the effects library, at the DM's
 * request. Effects mixed into a music folder are common, and no classifier is
 * trustworthy enough to reorganise someone's disk on its own — this only ever
 * runs from a click.
 */
handle(INVOKE.moveTrack, async (_e, trackPath: string, target: 'music' | 'sfx') => {
  const musicFolder = store.get('musicFolder', '') as string
  const sfxFolder = store.get('sfxFolder', '') as string
  const source = target === 'music' ? sfxFolder : musicFolder
  const destination = moveDestination(trackPath.split('/').pop() ?? trackPath, target, {
    music: musicFolder,
    sfx: sfxFolder,
  })
  if (!source || !destination) return { ok: false, reason: 'both folders must be set' }

  const from = join(source, trackPath)
  if (!fs.existsSync(from)) return { ok: false, reason: 'file not found' }

  const dir = join(destination, '..')
  fs.mkdirSync(dir, { recursive: true })
  const name = disambiguate(destination.split('/').pop() ?? '', (candidate) => fs.existsSync(join(dir, candidate)))
  const to = join(dir, name)
  try {
    fs.renameSync(from, to)
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }

  // Keep metadata and tags with the track rather than losing them on a move.
  try {
    const db = getDb()
    db.prepare('update tracks set path = ? where path = ?').run(to.replace(`${dir}/`, ''), trackPath)
    db.prepare('update track_tags set filename = ? where filename = ?').run(to.replace(`${dir}/`, ''), trackPath)
  } catch (e) {
    console.error('[library] could not update the moved track:', e)
  }

  invalidateMusicLibrary()
  if (musicFolder) launchScanner(musicFolder)
  return { ok: true, path: to }
})

// A lane is a label: switching it writes one row and leaves the file where the
// DM put it. Moving files is the action above, and it stays a separate one.
handle(INVOKE.setLane, (_e, key: string, lane: 'music' | 'sfx') => {
  if (lane !== 'music' && lane !== 'sfx') return { ok: false }
  const item = library.items().find((candidate) => candidate.key === key)
  // Choosing the folder's own lane is not an override; writing one would pin the
  // file forever and the classifier could never be improved.
  if (item && item.origin === lane) library.clearLane(key)
  else library.setLane(key, lane)
  // Every panel and the director read the same label, so they all have to hear it.
  send(EVENTS.sfxChanged)
  send(EVENTS.scanComplete)
  return { ok: true }
})

handle(INVOKE.setMusicFolder, (_e, folderPath: string) => {
  store.set('musicFolder', folderPath)
  launchScanner(folderPath)
  startBackgroundPasses()
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
    startBackgroundPasses()
    send(EVENTS.musicFolderChanged, result.filePaths[0])
    return result.filePaths[0]
  }
  return null
})

handle(INVOKE.listMusic, () => {
  // The lane decides what is offered, not the folder: a file the DM filed as an
  // effect is not a scene cue even if it lives in the music folder.
  return library.items('music').map((item) => (item.origin === 'music' ? item.path : item.absolute))
})

handle(INVOKE.triggerScan, () => {
  const musicFolder = store.get('musicFolder', '') as string
  if (!musicFolder) return { ok: false }
  launchScanner(musicFolder, true)
  return { ok: true }
})

handle(INVOKE.getAllMetadata, () => {
  const all = getAllMetadata()
  const kinds = library.kinds()
  // One library read for both the lane map and the items that have no analysed
  // row, so a metadata request costs one walk instead of two.
  const items = library.items()
  const lanes = new Map(items.map((item) => [item.key, item.lane]))
  // `lane` is the resolved label, not the folder: the renderer must not re-derive
  // it, or a badge would disagree with what search and the director use.
  type Row = (typeof all)[string] & { audioKind?: AudioKind; lane?: 'music' | 'sfx' }
  const withKind: Record<string, Row> = {}
  for (const [path, meta] of Object.entries(all)) {
    withKind[path] = {
      ...meta,
      ...(kinds[path] ? { audioKind: kinds[path] } : {}),
      ...(lanes.get(path) ? { lane: lanes.get(path) } : {}),
    }
  }
  // A cue that lives in the effects folder has no analysed row here, but its
  // label is still what the ranker must obey. Facts are absent, not invented.
  for (const item of items) {
    if (item.lane !== 'music') continue
    const key = item.origin === 'music' ? item.path : item.absolute
    if (!withKind[key]) withKind[key] = { lane: item.lane } as Row
  }
  return withKind
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

const sessionPass = createSessionPass({
  evaluate: (state, candidates) => evaluateSession(state, candidates),
  store: sessionStore,
  now: () => Date.now(),
})

handle(INVOKE.sessionEvaluate, (_e, request: PassRequest) => sessionPass.run(request))

handle(INVOKE.sessionDecision, (_e, row: Parameters<typeof sessionStore.recordDecision>[0]) => {
  sessionStore.recordDecision(row)
  return { ok: true }
})
handle(INVOKE.sessionPreference, (_e, row: Parameters<typeof sessionStore.recordPreference>[0]) => {
  sessionStore.recordPreference(row)
  return { ok: true }
})
handle(INVOKE.sessionReport, (_e, since: number) => sessionStore.report(since))

// ── The library: one owner of membership, descriptions and vectors ────────────
const EMBEDDER_DIR = join(MODELS_DIR, 'embeddinggemma-2')
let embedder: Awaited<ReturnType<typeof loadEmbedder>> | null = null

async function loadEmbedderOnce(): Promise<Awaited<ReturnType<typeof loadEmbedder>> | null> {
  if (embedder) return embedder
  if (!embedderAvailable(EMBEDDER_DIR)) return null
  embedder = await loadEmbedder(EMBEDDER_DIR)
  return embedder
}

const library = createLibrary({
  folders: () => ({
    music: store.get('musicFolder', '') as string,
    sfx: store.get('sfxFolder', '') as string,
  }),
  musicFiles: (folder) => getMusicFiles(folder),
  sfxItems: (folder) => listSfx(folder, getSfxDurations()),
  facts: () => getAllMetadata(),
  tags: () => getTagsMap(),
  overrides: () => getLaneOverrides(),
  setOverride: (key, lane) => setLaneOverride(key, lane),
  clearOverride: (key) => clearLaneOverride(key),
  embedder: () => loadEmbedderOnce(),
  embedderAvailable: () => embedderAvailable(EMBEDDER_DIR),
  audioAvailable: () => audioAvailable(EMBEDDER_DIR),
  kindAnchors: (model) => loadKindAnchors(model),
  // The decoder needs the real path. A relative one makes ffmpeg fail for every
  // track, silently, because the audio indexer treats a failure as unclassified.
  embedAudio: (absolute, durationSeconds) => embedTrackAudio(embedder!, absolute, clipWindow(durationSeconds)),
  store: sessionStore,
  onStatus: (status) => {
    send(EVENTS.embeddingProgress, status)
  },
})

/**
 * Effects are seconds long and never enter `tracks`, so their duration has to be
 * measured separately: it is what lets the lane rule tell a 6 s door slam from a
 * 3 min cue sitting in the same folder. One pass, cached, silent on failure.
 */
async function startSfxDurations(): Promise<void> {
  const folder = store.get('sfxFolder', '') as string
  if (!folder) return
  const cached = getSfxDurations()
  const missing = listSfx(folder).filter((item) => !cached[item.filename])
  if (missing.length === 0) return
  const { parseFile } = await import('music-metadata')
  for (const item of missing) {
    try {
      const meta = await parseFile(item.filename, { duration: true })
      const seconds = meta.format.duration
      if (seconds) setSfxDuration(item.filename, seconds)
    } catch {
      /* unreadable: it keeps the folder's answer */
    }
  }
  // The lanes were resolved with the old numbers.
  send(EVENTS.sfxChanged)
  send(EVENTS.scanComplete)
}

/**
 * Minutes of work, so it runs in the background and resumes next launch. Called
 * at startup and on a folder change, which used to leave a newly selected
 * library unindexed until the next launch.
 */
function startBackgroundPasses(): void {
  setTimeout(() => {
    void startSfxDurations().catch((e) => console.warn('[sfx] duration probe failed:', e))
    library
      .ensureIndexed()
      .then(() => {
        const status = library.status()
        if (!status.ready) console.log('[library] no embedding model installed; search falls back to text')
        else console.log(`[library] indexed ${status.indexed}/${status.total}`)
      })
      .catch((e) => console.error('[library] index failed:', e))
  }, 3_000)
}

handle(INVOKE.embeddingStatus, () => library.status())

handle(INVOKE.sfxRank, async (_e, state: string, candidates: string[]) => {
  if (candidates.length === 0 || !state.trim()) return []
  try {
    return await rankSfx(state, candidates)
  } catch (e) {
    console.error('[sfx] ranking failed:', e)
    return []
  }
})

handle(INVOKE.librarySearch, async (_e, text: string, lane: 'music' | 'sfx', k: number) => {
  try {
    const result = await library.search(text, lane, Math.max(1, Math.min(k, 50)))
    // `mode` travels with the results: the panel has to say when the answer came
    // from the fallback, and only main knows which matcher ran.
    return {
      mode: result.mode,
      items: result.items.map((item) => ({
        key: item.key,
        path: item.path,
        lane: item.lane,
        // The effects panel identifies its cards by absolute filename, the music
        // panel by relative path; both need to find the same result.
        absolute: item.absolute,
        // Which path plays: a music-folder file is relative, anything else is
        // only reachable by its absolute path.
        origin: item.origin,
      })),
    }
  } catch (e) {
    console.error('[library] search failed:', e)
    return { mode: 'text' as const, items: [] }
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

/** Small optional GGUFs (VAD, language ID). A failure degrades, it does not block. */
async function ensureSideModels(): Promise<void> {
  for (const side of STT_SIDE_MODELS) {
    if (side.isReady()) continue
    const result = await sttDownloads.start({ id: side.id, url: side.url }, join(MODELS_DIR, side.ggufFile))
    if (!result.ok) console.warn(`[model] optional ${side.id} not installed:`, result)
  }
}

handle(INVOKE.downloadModel, async (_e, modelId?: SttModelType) => {
  const modelInfo = modelId
    ? (STT_MODELS.find((m) => m.id === modelId) ?? STT_MODELS[0])
    : (STT_MODELS.find((m) => m.id === DEFAULT_STT_MODEL) ?? STT_MODELS[0])

  if (modelInfo.isReady()) {
    store.set('sttModel', modelInfo.id)
    await ensureSideModels()
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
  await ensureSideModels()
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

handle(INVOKE.discordHasToken, async () => {
  return (await loadToken()) !== ''
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

handle(INVOKE.getSfxList, () => {
  const known = new Map(
    listSfx(store.get('sfxFolder', '') as string, getSfxDurations()).map((item) => [`sfx:${item.id}`, item]),
  )
  return library.items('sfx').map((item) => {
    const found = known.get(item.key)
    if (found) return { ...found, lane: item.lane }
    // A file the DM filed as an effect but which lives in the music folder: show
    // it in the effects shelf, addressed by its absolute path.
    return {
      // Its own id space: the effects panel is keyed by id, and a music-folder
      // path could collide with an effect of the same name.
      id: `music:${item.path}`,
      filename: item.absolute,
      category: 'from the music folder',
      label: (item.path.split('/').pop() ?? item.path).replace(/\.[^.]+$/, ''),
      description: '',
      duration: 0,
      source: 'custom' as const,
      lane: item.lane,
    }
  })
})

handle(INVOKE.libraryLanes, () => {
  const out: Record<string, { key: string; lane: 'music' | 'sfx'; origin: 'music' | 'sfx' }> = {}
  for (const item of library.items()) {
    const entry = { key: item.key, lane: item.lane, origin: item.origin }
    // Keyed by what each panel renders. A music-folder file is shown by relative
    // path in the music panel and by absolute path if it appears in the effects
    // shelf; an effects-folder file is always addressed absolutely. Never key by
    // the relative id of an effect: the two folders share that name space.
    if (item.origin === 'music') out[item.path] = entry
    out[item.absolute] = entry
  }
  return out
})

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
  // The effects folder is part of the library now: it needs vectors too.
  startBackgroundPasses()
  return { ok: true }
})

handle(INVOKE.getSfxRecommendationCount, () => store.get('sfxRecommendationCount', 5))

handle(INVOKE.setSfxRecommendationCount, (_e, count: number) => {
  store.set('sfxRecommendationCount', Math.max(1, Math.min(10, Math.round(count))))
  return { ok: true }
})

// ── IPC: Autopilot (#12) ──────────────────────────────────────────────────────

handle(INVOKE.getAutopilotConfig, () => ({
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

// ── IPC: Debug ────────────────────────────────────────────────────────────────

/** Facts a DM can paste from another Mac, without reading a single log line. */
async function diagnostics(): Promise<string> {
  const ffmpeg = await ffmpegStatus()
  const discord = discordGetState()
  return [
    `Doty ${app.getVersion()} · Electron ${process.versions.electron} · ${process.getSystemVersion()} · ${process.arch}`,
    `Profile: ${DOTY_HOME}`,
    `Music folder: ${store.get('musicFolder', '') || '(none)'}`,
    `SFX folder: ${store.get('sfxFolder', '') || '(none)'}`,
    `Speech model: ${store.get('sttModel', DEFAULT_STT_MODEL)} (${isAnySttModelReady() ? 'ready' : 'not installed'})`,
    `ffmpeg: ${ffmpeg.ok ? 'ok' : 'FAILED'} — ${ffmpeg.detail}`,
    `ffmpeg path: ${ffmpeg.path}`,
    `Discord: ${discord.status} / voice ${discord.voiceStatus}${discord.error ? ` — ${discord.error}` : ''}`,
    `Log: ${debugLogger.path}`,
  ].join('\n')
}

async function debugState() {
  return {
    enabled: store.get('debugMode', false) ?? false,
    logPath: debugLogger.path,
    log: debugLogger.tail(200),
    diagnostics: await diagnostics(),
  }
}

handle(INVOKE.debugGetState, () => debugState())

handle(INVOKE.debugSetEnabled, async (_e, enabled: boolean) => {
  const on = enabled === true
  store.set('debugMode', on)
  enableDebugLogging(on)
  setDiscordVerbose(on)
  return debugState()
})

handle(INVOKE.debugOpenLog, async () => {
  debugLogger.ensure()
  const error = await shell.openPath(debugLogger.path)
  return error ? { ok: false, error } : { ok: true }
})
