import fs from 'node:fs'
import https from 'node:https'
import { join } from 'node:path'
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
  startStream,
} from './asr'
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
  stopStream,
  streamSfx,
  streamTrack,
  tryAutoConnect,
} from './discord'
import { migrateFromJson } from './metadata-cache'
import { isAnySttModelReady, MODELS_DIR, STT_MODELS, type SttModelType } from './model-paths'
import { getAllMetadata, getMetadata, startScanner, stopScanner } from './scanner'
import * as sessionOps from './sessions'
import { store } from './store'
import { updateWavHeader } from './wav-header'

// ── Download helper ───────────────────────────────────────────────────────────
/** Download a file from a URL with progress reporting. Follows redirects. */
function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (percent: number, downloadedMB: number, totalMB: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(join(destPath, '..'), { recursive: true })
    const file = fs.createWriteStream(destPath)
    const get = (u: string) => {
      https
        .get(u, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            return get(res.headers.location!)
          }
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${u}`))
          const total = parseInt(res.headers['content-length'] || '0', 10)
          let downloaded = 0
          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length
            file.write(chunk)
            if (total > 0 && onProgress) {
              onProgress(
                Math.round((downloaded / total) * 100),
                Math.round(downloaded / 1024 / 1024),
                Math.round(total / 1024 / 1024),
              )
            }
          })
          res.on('end', () => file.close(() => resolve()))
          res.on('error', reject)
        })
        .on('error', reject)
    }
    get(url)
  })
}

// ponytail: no aux models needed — transcribe-cpp handles everything in one GGUF

/** Check if the reranker model is already cached */
function isRerankerCached(): boolean {
  const rerankerDir = join(app.getPath('home'), '.doty', 'hf-cache', 'cross-encoder', 'mmarco-mMiniLMv2-L12-H384-v1')
  try {
    return fs.existsSync(join(rerankerDir, 'onnx', 'model.onnx'))
  } catch {
    return false
  }
}

/**
 * Pre-download the reranker model in the main process (Node.js context).
 * The renderer worker's fetch can stall in Electron's sandboxed context,
 * so we download here where Node.js networking works reliably, then the
 * worker loads from the local cache with allowRemoteModels=false.
 */
async function downloadRerankerModel(): Promise<void> {
  if (isRerankerCached()) {
    console.log('[main] Reranker model already cached')
    return
  }

  console.log('[main] Pre-downloading reranker model in main process...')
  try {
    // Dynamic require — the package is externalized by electron-vite so Node's
    // module resolution finds it in the project root node_modules.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AutoTokenizer, AutoModelForSequenceClassification, env } = require('@huggingface/transformers')
    const homePath = app.getPath('home')
    env.cacheDir = join(homePath, '.doty', 'hf-cache')
    env.allowRemoteModels = true

    const MODEL_ID = 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1'

    // Notify renderer about download progress via IPC
    const sendProgress = (p: Record<string, unknown>) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('reranker:download-progress', p)
      }
    }

    const progressCb = (p: Record<string, unknown>) => {
      if (p.status === 'progress' || p.status === 'download' || p.status === 'initiate' || p.status === 'done') {
        sendProgress(p)
      }
    }

    await AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback: progressCb })
    await AutoModelForSequenceClassification.from_pretrained(MODEL_ID, {
      device: 'cpu',
      dtype: 'fp32',
      progress_callback: progressCb,
    })

    console.log('[main] Reranker model pre-downloaded successfully')
  } catch (e) {
    console.error('[main] Reranker model pre-download failed (non-fatal):', e)
  }
}

// Register app:// as a privileged scheme BEFORE app is ready.
// This makes the renderer a secure context (like https://) so the Cache API
// is available — transformers.js uses it to cache model weights between launches.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'music', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

const AUDIO_RE = /\.(mp3|flac|wav|m4a|ogg|aac)$/i

function listMusicFiles(dir: string, root?: string): string[] {
  const base = root ?? dir
  const results: string[] = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        results.push(...listMusicFiles(full, base))
      } else if (AUDIO_RE.test(entry.name)) {
        results.push(full.slice(base.length + 1))
      }
    }
  } catch {
    /* skip unreadable dirs */
  }
  return results
}

let mainWindow: BrowserWindow | null = null
let sessionStartTime: number | null = null
let sessionWavFd: number | null = null
let sessionWavBytes = 0
let wavHeaderInterval: ReturnType<typeof setInterval> | null = null

function getActiveSessionFile(): string | null {
  return sessionOps.getLastSession()
}

function getSessionWavPath(): string | null {
  const vtt = getActiveSessionFile()
  if (!vtt) return null
  return vtt.replace(/\.vtt$/, '.wav')
}

function startWavRecording(): void {
  const wavPath = getSessionWavPath()
  if (!wavPath) return
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
  sessionWavFd = fs.openSync(wavPath, 'r+')
  sessionWavBytes = 0
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
  fs.appendFileSync(sessionWavFd, int16)
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
      mainWindow?.webContents.send('scan:progress', { done, total, current })
    },
    () => {
      mainWindow?.webContents.send('scan:complete')
    },
    force,
  )
}

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
}

/** MIME type lookup for audio files. */
function audioMime(ext: string): string {
  const map: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.aac': 'audio/aac',
  }
  return map[ext.toLowerCase()] ?? 'application/octet-stream'
}

function registerMusicProtocol() {
  protocol.handle('music', (request) => {
    try {
      const musicFolder = store.get('musicFolder', '') as string
      const raw = request.url
      const prefix = 'music://play/'
      const filename = decodeURIComponent(
        raw.startsWith(prefix) ? raw.slice(prefix.length) : raw.slice('music://'.length),
      )
      // Support absolute paths (for SFX) or relative paths (for music).
      // Chromium normalises %2F → / in custom-scheme URLs, so an absolute path
      // like /Users/x/sfx/boom.mp3 arrives as "Users/x/sfx/boom.mp3" (leading
      // slash consumed by the music://play/ prefix).  We try the relative path
      // first; if it doesn't exist we retry as an absolute path with "/" prepended.
      let filePath = filename.startsWith('/') ? filename : join(musicFolder, filename)

      if (!fs.existsSync(filePath) && !filename.startsWith('/')) {
        const abs = `/${filename}`
        if (fs.existsSync(abs)) filePath = abs
      }

      if (!fs.existsSync(filePath)) {
        return new Response('Not found', { status: 404 })
      }

      const stat = fs.statSync(filePath)
      const total = stat.size
      const ext = filePath.slice(filePath.lastIndexOf('.'))
      const mime = audioMime(ext)

      /** Wrap a Node fs.ReadStream into a web ReadableStream, guarding against
       *  enqueue-after-close crashes that happen when Chromium cancels a request
       *  mid-stream (e.g. rapid seeking). */
      function nodeToWeb(nodeStream: fs.ReadStream): ReadableStream {
        let closed = false
        return new ReadableStream({
          start(controller) {
            nodeStream.on('data', (chunk: Buffer | string) => {
              if (!closed) {
                try {
                  controller.enqueue(chunk)
                } catch {
                  closed = true
                  nodeStream.destroy()
                }
              }
            })
            nodeStream.on('end', () => {
              if (!closed) {
                closed = true
                try {
                  controller.close()
                } catch {
                  /* already closed */
                }
              }
            })
            nodeStream.on('error', (err) => {
              if (!closed) {
                closed = true
                try {
                  controller.error(err)
                } catch {
                  /* already errored */
                }
              }
            })
          },
          cancel() {
            closed = true
            nodeStream.destroy()
          },
        })
      }

      // Handle Range requests — required for audio seeking.
      // Without this, setting audio.currentTime causes Chromium to request a byte
      // range, but net.fetch(file://) always returns the full file from byte 0,
      // so the seek position resets to the beginning.
      const rangeHeader = request.headers.get('Range')
      if (rangeHeader) {
        const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
        const start = match ? parseInt(match[1], 10) : 0
        const end = match?.[2] ? parseInt(match[2], 10) : total - 1

        // Validate range bounds
        if (start >= total || end >= total || start > end) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${total}` },
          })
        }

        const chunkSize = end - start + 1

        return new Response(nodeToWeb(fs.createReadStream(filePath, { start, end })), {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(chunkSize),
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
          },
        })
      }

      // Full file response — advertise Accept-Ranges so Chromium knows
      // it can send Range requests for seeking.
      return new Response(nodeToWeb(fs.createReadStream(filePath)), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(total),
          'Accept-Ranges': 'bytes',
        },
      })
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

  const ready = isAnySttModelReady()
  mainWindow?.webContents.send('model:status', { ready })

  // Always set up ASR callbacks (process starts lazily on first transcribe)
  setOnFlushText((text) => {
    mainWindow?.webContents.send('stt:transcript', text)
    const file = getActiveSessionFile()
    if (file) {
      if (!sessionStartTime) sessionStartTime = Date.now()
      const elapsed = Date.now() - sessionStartTime
      sessionOps.appendCue(file, elapsed, text)
    }
  })
  setOnInterimText((text) => {
    mainWindow?.webContents.send('stt:interim', text)
  })
  setOnAsrStatus((status) => {
    mainWindow?.webContents.send('stt:status', status)
  })

  if (ready) {
    // Pre-download reranker model in main process (worker fetch stalls in Electron)
    downloadRerankerModel().catch(() => {})
    // Init ASR immediately — transcribe-cpp loads in ~160ms
    try {
      initRecognizer()
    } catch (e) {
      console.error('ASR init error:', e)
    }
  }

  const musicFolder = store.get('musicFolder', '') as string
  if (musicFolder) launchScanner(musicFolder)

  // Forward Discord state changes to renderer
  onStateChange((discordState) => {
    mainWindow?.webContents.send('discord:state', discordState)
  })

  // Auto-connect to last Discord voice channel if enabled
  tryAutoConnect()
})

app.on('before-quit', () => {
  freeRecognizer()
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

ipcMain.handle('mic:check-permission', () => {
  if (process.platform !== 'darwin') return 'granted'
  const { systemPreferences } = require('electron')
  return systemPreferences.getMediaAccessStatus('microphone')
})

ipcMain.handle('mic:request-permission', async () => {
  if (process.platform !== 'darwin') return true
  const { systemPreferences } = require('electron')
  return systemPreferences.askForMediaAccess('microphone')
})

ipcMain.handle('mic:open-settings', () => {
  const { shell } = require('electron')
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
})

// ── IPC: STT ──────────────────────────────────────────────────────────────────

ipcMain.handle('stt:start', () => {
  sessionStartTime = Date.now()
  startWavRecording()
  startStream()
  return { ok: true }
})
ipcMain.handle('stt:stop', () => {
  finalizeStream()
  finalizeWavRecording()
  return { ok: true }
})

// Renderer sends PCM segments as Float32Array buffers.
// In streaming mode, feeds chunks to the active stream.
// Results come back via 'stt:transcript' and 'stt:interim' events.
ipcMain.handle('stt:transcribe-chunk', async (_e, buffer: ArrayBuffer) => {
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

ipcMain.handle('music:set-folder', (_e, folderPath: string) => {
  store.set('musicFolder', folderPath)
  launchScanner(folderPath)
  return { ok: true }
})

ipcMain.handle('music:get-folder', () => store.get('musicFolder', ''))

ipcMain.handle('music:pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Music Folder',
  })
  if (!result.canceled && result.filePaths[0]) {
    store.set('musicFolder', result.filePaths[0])
    launchScanner(result.filePaths[0])
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('music:list', () => {
  const musicFolder = store.get('musicFolder', '') as string
  if (!musicFolder) return []
  return listMusicFiles(musicFolder)
})

ipcMain.handle('music:scan', () => {
  const musicFolder = store.get('musicFolder', '') as string
  if (!musicFolder) return { ok: false }
  launchScanner(musicFolder, true)
  return { ok: true }
})

ipcMain.handle('music:get-metadata', (_e, relPath: string) => {
  return getMetadata(relPath)
})

ipcMain.handle('music:get-all-metadata', () => {
  return getAllMetadata()
})

// ── IPC: Tags ─────────────────────────────────────────────────────────────────

ipcMain.handle('tags:get', (_e, filename: string) => getTags(filename))

ipcMain.handle('tags:set', (_e, filename: string, tags: string[]) => {
  setTags(filename, tags)
  return { ok: true }
})

ipcMain.handle('tags:get-all', () => getAllTags())

ipcMain.handle('tags:get-map', () => getTagsMap())

// ── IPC: Play History ─────────────────────────────────────────────────────────

ipcMain.handle('history:record-play', (_e, itemId: string, itemType: 'music' | 'sfx') => {
  recordPlay(itemId, itemType)
  return { ok: true }
})

ipcMain.handle('history:get-frequencies', (_e, itemType: 'music' | 'sfx') => {
  return getPlayFrequencies(itemType)
})

ipcMain.handle('history:get-top-played', (_e, itemType: 'music' | 'sfx', limit?: number) => {
  return getTopPlayed(itemType, limit)
})

// ── IPC: Transcripts ──────────────────────────────────────────────────────────

ipcMain.handle('transcript:get-folder', () => store.get('transcriptFolder', ''))

ipcMain.handle('transcript:pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Transcript Folder',
  })
  if (!result.canceled && result.filePaths[0]) {
    store.set('transcriptFolder', result.filePaths[0])
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('transcript:save', (_e, text: string) => {
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

ipcMain.handle('session:create', (_e, name?: string) => {
  return sessionOps.createSession(name)
})

ipcMain.handle('session:list', () => {
  return sessionOps.listSessions()
})

ipcMain.handle('session:load', async (_e, file: string) => {
  sessionOps.setLastSession(file)
  return sessionOps.loadSessionAsync(file)
})

ipcMain.handle('session:rename', (_e, file: string, newName: string) => {
  sessionOps.renameSession(file, newName)
})

ipcMain.handle('session:delete', (_e, file: string) => {
  sessionOps.deleteSession(file)
  return { ok: true }
})

ipcMain.handle('session:get-last', () => {
  return sessionOps.getLastSession()
})

// ── IPC: Reprocess (TODO: rewrite for transcribe-cpp batch mode) ──────────────

let reprocessWorker: NodeWorker | null = null

ipcMain.handle('reprocess:start', (_e, _sessionFile: string, _modelId: string) => {
  // ponytail: reprocess needs rewrite for transcribe-cpp. Stub for now.
  return { ok: false, reason: 'Reprocess not yet available with new STT engine' }
})

ipcMain.handle('reprocess:cancel', () => {
  if (reprocessWorker) {
    reprocessWorker.terminate()
    reprocessWorker = null
  }
  return { ok: true }
})

// ── IPC: Model download ───────────────────────────────────────────────────────

// isAnySttModelReady imported from model-paths

ipcMain.handle('model:status', () => ({ ready: isAnySttModelReady() }))

ipcMain.handle('reranker:status', () => ({ cached: isRerankerCached() }))

// Reranker scoring via IPC — replaces broken WASM worker
let _rerankerScorer: ((pairs: Array<{ text: string; text_pair: string }>) => Promise<number[]>) | null = null
let _rerankerLoading: Promise<void> | null = null

ipcMain.handle('reranker:score', async (_e, pairs: Array<{ text: string; text_pair: string }>) => {
  if (!pairs || pairs.length === 0) return []
  if (!_rerankerScorer) {
    if (!_rerankerLoading) {
      _rerankerLoading = (async () => {
        const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import('@huggingface/transformers')
        env.cacheDir = join(app.getPath('home'), '.doty', 'hf-cache')
        env.allowRemoteModels = true
        const MODEL_ID = 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1'
        console.log('[reranker-ipc] loading model...')
        mainWindow?.webContents.send('reranker:ipc-status', 'loading')
        const [tokenizer, model] = await Promise.all([
          AutoTokenizer.from_pretrained(MODEL_ID),
          AutoModelForSequenceClassification.from_pretrained(MODEL_ID, { device: 'cpu', dtype: 'fp32' }),
        ])
        _rerankerScorer = async (p) => {
          const inputs = (tokenizer as any)(
            p.map((x) => x.text),
            { text_pair: p.map((x) => x.text_pair), padding: true, truncation: true },
          )
          const { logits } = await (model as any)(inputs)
          return Array.from(logits.data as Float32Array)
        }
        console.log('[reranker-ipc] model ready')
        mainWindow?.webContents.send('reranker:ipc-status', 'ready')
      })()
    }
    await _rerankerLoading
  }
  return await _rerankerScorer!(pairs)
})

ipcMain.handle('settings:get-recommendation-count', () => store.get('recommendationCount', 5))

ipcMain.handle('settings:set-recommendation-count', (_e, count: number) => {
  store.set('recommendationCount', Math.max(1, Math.min(20, Math.round(count))))
  return { ok: true }
})

// ── IPC: Hotwords (legacy stubs — transcribe-cpp doesn't use hotwords) ────────

ipcMain.handle('settings:get-hotwords-file', () => '')
ipcMain.handle('settings:set-hotwords-file', () => ({ ok: true }))
ipcMain.handle('settings:pick-hotwords-file', async () => null)
ipcMain.handle('settings:create-default-hotwords', () => ({ ok: true, path: '' }))

ipcMain.handle('model:download', async (_e, modelId?: SttModelType) => {
  const modelInfo = modelId ? (STT_MODELS.find((m) => m.id === modelId) ?? STT_MODELS[0]) : STT_MODELS[0]

  if (modelInfo.isReady()) {
    store.set('sttModel', modelInfo.id)
    initRecognizer()
    mainWindow?.webContents.send('model:status', { ready: true })
    return { ok: true }
  }

  // Download single GGUF file
  const destPath = join(MODELS_DIR, modelInfo.ggufFile)
  try {
    await downloadFile(modelInfo.url, destPath, (percent, downloadedMB, totalMB) => {
      mainWindow?.webContents.send('model:progress', { percent, downloadedMB, totalMB })
    })

    store.set('sttModel', modelInfo.id)
    initRecognizer()
    mainWindow?.webContents.send('model:status', { ready: true })
    downloadRerankerModel().catch(() => {})
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e) }
  }
})

// ── IPC: STT Model Selection ─────────────────────────────────────────────────

ipcMain.handle('stt:get-model', () => {
  return store.get('sttModel', 'parakeet-unified-en') as string
})

ipcMain.handle('stt:set-model', (_e, modelId: SttModelType) => {
  const current = store.get('sttModel', '') as string
  if (current === modelId) return { ok: true }
  const modelInfo = STT_MODELS.find((m) => m.id === modelId)
  if (!modelInfo) return { ok: false, reason: 'unknown model' }
  if (!modelInfo.isReady()) return { ok: false, reason: 'model not downloaded' }
  store.set('sttModel', modelId)
  restartRecognizer()
  // Notify renderer about the switch
  mainWindow?.webContents.send('stt:model-switched', { id: modelId, label: modelInfo.label })
  return { ok: true }
})

ipcMain.handle('stt:get-model-status', () => {
  return Object.fromEntries(STT_MODELS.map((m) => [m.id, m.isReady()]))
})

/** Return the model registry for the renderer */
ipcMain.handle('stt:get-model-list', () => {
  return STT_MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    description: m.description,
    size: m.size,
    streaming: m.streaming,
    languages: m.languages,
    ready: m.isReady(),
  }))
})

// ── IPC: Discord ──────────────────────────────────────────────────────────────

ipcMain.handle('discord:connect', async (_e, token?: string) => {
  try {
    await discordConnect(token)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('discord:disconnect', async () => {
  await discordDisconnect()
  return { ok: true }
})

ipcMain.handle('discord:get-state', () => discordGetState())

ipcMain.handle('discord:get-guilds', () => getGuilds())

ipcMain.handle('discord:get-voice-channels', (_e, guildId: string) => getVoiceChannels(guildId))

ipcMain.handle('discord:join-channel', async (_e, guildId: string, channelId: string) => {
  try {
    await joinChannel(guildId, channelId)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('discord:leave-channel', () => {
  leaveChannel()
  return { ok: true }
})

ipcMain.handle('discord:stream-track', (_e, filename: string, seekSeconds?: number) => {
  streamTrack(filename, seekSeconds ?? 0)
  return { ok: true }
})

ipcMain.handle('discord:stream-sfx', (_e, absolutePath: string, volume?: number) => {
  streamSfx(absolutePath, volume)
  return { ok: true }
})

ipcMain.handle('discord:stop-stream', () => {
  stopStream()
  return { ok: true }
})

ipcMain.handle('discord:pause-stream', () => {
  pauseStream()
  return { ok: true }
})

ipcMain.handle('discord:resume-stream', () => {
  resumeStream()
  return { ok: true }
})

ipcMain.handle('discord:set-volume', (_e, volume: number) => {
  setDiscordVolume(volume)
  return { ok: true }
})

ipcMain.handle('discord:get-volume', () => getDiscordVolume())

ipcMain.handle('discord:has-token', () => {
  return loadToken() !== ''
})

ipcMain.handle('discord:clear-token', () => {
  clearToken()
  return { ok: true }
})

ipcMain.handle('discord:get-auto-connect', () => getAutoConnect())

ipcMain.handle('discord:set-auto-connect', (_e, enabled: boolean) => {
  setAutoConnect(enabled)
  return { ok: true }
})

// ── IPC: SFX ─────────────────────────────────────────────────────────────────

function scanSfxFolder(folder: string): any[] {
  if (!folder || !fs.existsSync(folder)) return []

  const results: any[] = []
  const audioRe = /\.(mp3|flac|wav|m4a|ogg|aac)$/i

  function scan(dir: string, category: string) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          scan(fullPath, entry.name)
        } else if (audioRe.test(entry.name)) {
          const id = fullPath.replace(folder, '').replace(/^\//, '')
          const label = entry.name.replace(audioRe, '').replace(/[-_]/g, ' ')
          results.push({
            id,
            filename: fullPath,
            category: category || 'custom',
            label,
            description: '',
            duration: 0,
            source: 'custom',
          })
        }
      }
    } catch (e) {
      console.error('[sfx] scan error:', e)
    }
  }

  scan(folder, '')
  return results
}

ipcMain.handle('sfx:list', () => {
  const folder = store.get('sfxFolder', '') as string
  return scanSfxFolder(folder)
})

ipcMain.handle('sfx:get-folder', () => store.get('sfxFolder', ''))

ipcMain.handle('sfx:pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select SFX Folder',
  })
  if (!result.canceled && result.filePaths[0]) {
    store.set('sfxFolder', result.filePaths[0])
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('sfx:set-folder', (_e, folderPath: string) => {
  store.set('sfxFolder', folderPath)
  return { ok: true }
})

ipcMain.handle('settings:get-sfx-recommendation-count', () => store.get('sfxRecommendationCount', 5))

ipcMain.handle('settings:set-sfx-recommendation-count', (_e, count: number) => {
  store.set('sfxRecommendationCount', Math.max(1, Math.min(10, Math.round(count))))
  return { ok: true }
})

// ── IPC: Autopilot (#12) ──────────────────────────────────────────────────────

ipcMain.handle('autopilot:get-config', () => ({
  enabled: store.get('autopilotEnabled', false),
  musicEnabled: store.get('autopilotMusicEnabled', true),
  sfxEnabled: store.get('autopilotSfxEnabled', true),
  confidenceThreshold: store.get('autopilotConfidenceThreshold', 0.95),
  crossfadeDuration: store.get('autopilotCrossfadeDuration', 3),
  musicCooldownSeconds: store.get('autopilotMusicCooldown', 60),
  minPlaySeconds: store.get('autopilotMinPlaySeconds', 30),
  sfxPerEffectCooldownSeconds: store.get('autopilotSfxPerEffectCooldown', 30),
  sfxGlobalCooldownSeconds: store.get('autopilotSfxGlobalCooldown', 10),
  sfxAutoVolume: store.get('autopilotSfxAutoVolume', 0.7),
}))

ipcMain.handle('autopilot:set-config', (_e, config: Record<string, unknown>) => {
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
  return { ok: true }
})
