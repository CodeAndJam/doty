import { exec } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron'
import { freeRecognizer, initRecognizer, restartRecognizer, setOnFlushText, transcribeFloat32 } from './asr'
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
import {
  DEFAULT_HOTWORDS_PATH,
  DENOISER_MODEL_PATH,
  DENOISER_MODEL_URL,
  getSttModelInfo,
  isDenoiserReady,
  isRerankerCached,
  isVadReady,
  STT_MODELS,
  type SttModelType,
  VAD_MODEL_PATH,
  VAD_MODEL_URL,
} from './model-paths'
import { getAllMetadata, getMetadata, startScanner, stopScanner } from './scanner'
import { store } from './store'

// ── Download helper ───────────────────────────────────────────────────────────
/** Download a file from a URL (follows redirects). Ensures parent dir exists. */
function downloadFile(url: string, destPath: string): Promise<void> {
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
          res.pipe(file)
          file.on('finish', () => file.close(() => resolve()))
          res.on('error', reject)
        })
        .on('error', reject)
    }
    get(url)
  })
}

/** Download auxiliary STT models (VAD, denoiser) if not present. Non-fatal. */
async function downloadAuxModels(): Promise<void> {
  // Silero VAD (~2MB)
  if (!isVadReady()) {
    try {
      await downloadFile(VAD_MODEL_URL, VAD_MODEL_PATH)
      console.log('[main] Silero VAD model downloaded')
    } catch (e) {
      console.error('[main] VAD download failed (non-fatal):', e)
    }
  }

  // GTCRN speech denoiser (~200KB)
  if (!isDenoiserReady()) {
    try {
      await downloadFile(DENOISER_MODEL_URL, DENOISER_MODEL_PATH)
      console.log('[main] GTCRN denoiser model downloaded')
    } catch (e) {
      console.error('[main] Denoiser download failed (non-fatal):', e)
    }
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
let sessionTranscriptFile: string | null = null

function getSessionTranscriptFile(): string | null {
  const folder = store.get('transcriptFolder', '') as string
  if (!folder) return null
  if (!sessionTranscriptFile) {
    fs.mkdirSync(folder, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    sessionTranscriptFile = join(folder, `transcript-${ts}.txt`)
  }
  return sessionTranscriptFile
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

  if (ready) {
    // Download auxiliary STT models (VAD, denoiser) if not present
    await downloadAuxModels()
    // Pre-download reranker model in main process (worker fetch stalls in Electron)
    downloadRerankerModel().catch(() => {})

    setTimeout(() => {
      try {
        initRecognizer()
        // Forward VAD flush text to renderer (sentence tails after silence)
        setOnFlushText((text) => {
          mainWindow?.webContents.send('stt:transcript', text)
          const file = getSessionTranscriptFile()
          if (file) fs.appendFileSync(file, `${text}\n`, 'utf-8')
        })
      } catch (e) {
        console.error('ASR init error:', e)
      }
    }, 2000)
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

// ── IPC: STT ──────────────────────────────────────────────────────────────────

ipcMain.handle('stt:start', () => {
  sessionTranscriptFile = null
  return { ok: true }
})
ipcMain.handle('stt:stop', () => ({ ok: true }))

// Renderer sends 1s PCM segments as Float32Array buffers.
// The ASR worker uses Silero VAD to detect speech boundaries, then
// transcribes each speech segment. Results are sent back via 'stt:transcript'.
ipcMain.handle('stt:transcribe-chunk', async (_e, buffer: ArrayBuffer) => {
  try {
    const samples = new Float32Array(buffer)
    const text = await transcribeFloat32(samples, 16000)
    if (text) {
      mainWindow?.webContents.send('stt:transcript', text)
      const file = getSessionTranscriptFile()
      if (file) fs.appendFileSync(file, `${text}\n`, 'utf-8')
    }
    return { text }
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

// ── IPC: Model download ───────────────────────────────────────────────────────

/** Check if the user has a usable STT model: they must have selected one and it must be ready */
function isAnySttModelReady(): boolean {
  const selected = store.get('sttModel', '') as string
  if (!selected) return false // fresh install — no model selected yet
  const model = STT_MODELS.find((m) => m.id === selected)
  return model ? model.isReady() : false
}

ipcMain.handle('model:status', () => ({ ready: isAnySttModelReady() }))

ipcMain.handle('reranker:status', () => ({ cached: isRerankerCached() }))

ipcMain.handle('settings:get-recommendation-count', () => store.get('recommendationCount', 5))

ipcMain.handle('settings:set-recommendation-count', (_e, count: number) => {
  store.set('recommendationCount', Math.max(1, Math.min(20, Math.round(count))))
  return { ok: true }
})

// ── IPC: Hotwords ─────────────────────────────────────────────────────────────

ipcMain.handle('settings:get-hotwords-file', () => store.get('hotwordsFile', ''))

ipcMain.handle('settings:set-hotwords-file', (_e, filePath: string) => {
  store.set('hotwordsFile', filePath)
  // Restart the ASR worker to pick up the new hotwords
  try {
    restartRecognizer()
  } catch (e) {
    console.error('ASR restart error:', e)
  }
  return { ok: true }
})

ipcMain.handle('settings:pick-hotwords-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    title: 'Select Hotwords File',
    filters: [{ name: 'Text Files', extensions: ['txt'] }],
  })
  if (!result.canceled && result.filePaths[0]) {
    store.set('hotwordsFile', result.filePaths[0])
    try {
      restartRecognizer()
    } catch (e) {
      console.error('ASR restart error:', e)
    }
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('settings:create-default-hotwords', () => {
  const defaultContent = `# Doty Hotwords — one phrase per line
# Add campaign-specific names, places, spells, etc.
# Lines starting with # are ignored by sherpa-onnx
#
# Examples:
# Fireball
# Eldritch Blast
# Strahd
# Waterdeep
# Dungeons and Dragons
`
  try {
    if (!fs.existsSync(DEFAULT_HOTWORDS_PATH)) {
      fs.mkdirSync(join(DEFAULT_HOTWORDS_PATH, '..'), { recursive: true })
      fs.writeFileSync(DEFAULT_HOTWORDS_PATH, defaultContent, 'utf-8')
    }
    store.set('hotwordsFile', DEFAULT_HOTWORDS_PATH)
    return { ok: true, path: DEFAULT_HOTWORDS_PATH }
  } catch (e) {
    return { ok: false, reason: String(e) }
  }
})

ipcMain.handle('model:download', async (_e, modelId?: SttModelType) => {
  const model = modelId ? (STT_MODELS.find((m) => m.id === modelId) ?? STT_MODELS[0]) : STT_MODELS[0]

  if (model.downloadMethod === 'auto') {
    // Voxtral and similar: auto-downloaded by transformers.js on first use.
    // Don't block — return immediately so the UI transitions to the main screen.
    store.set('sttModel', model.id)
    mainWindow?.webContents.send('model:status', { ready: true })
    // Fire-and-forget: aux models + reranker download in background
    downloadAuxModels().catch(() => {})
    downloadRerankerModel().catch(() => {})
    setTimeout(() => {
      try {
        initRecognizer()
        setOnFlushText((text) => {
          mainWindow?.webContents.send('stt:transcript', text)
          const file = getSessionTranscriptFile()
          if (file) fs.appendFileSync(file, `${text}\n`, 'utf-8')
        })
      } catch (e) {
        console.error('ASR init error:', e)
      }
    }, 500)
    return { ok: true }
  }

  // tar.bz2 download + extract
  fs.mkdirSync(join(model.dir, '..'), { recursive: true })
  const tarName = `${model.id}.tar.bz2`
  const tarPath = join(model.dir, '..', tarName)

  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(tarPath)
    const get = (url: string) => {
      https
        .get(url, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            return get(res.headers.location!)
          }
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))

          const total = parseInt(res.headers['content-length'] || '0', 10)
          let downloaded = 0

          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length
            file.write(chunk)
            if (total > 0) {
              mainWindow?.webContents.send('model:progress', {
                percent: Math.round((downloaded / total) * 100),
                downloadedMB: Math.round(downloaded / 1024 / 1024),
                totalMB: Math.round(total / 1024 / 1024),
              })
            }
          })
          res.on('end', () => file.close(() => resolve()))
          res.on('error', reject)
        })
        .on('error', reject)
    }
    get(model.url)
  })

  await new Promise<void>((resolve, reject) => {
    const destDir = join(model.dir, '..')
    const beforeDirs = new Set(fs.readdirSync(destDir))
    exec(`tar -xjf "${tarPath}" -C "${destDir}"`, (err) => {
      if (err) return reject(err)
      try {
        fs.unlinkSync(tarPath)
      } catch {
        /* non-fatal */
      }
      // Rename extracted directory to match expected model.dir
      if (!fs.existsSync(model.dir)) {
        const afterEntries = fs.readdirSync(destDir, { withFileTypes: true })
        const newDir = afterEntries.find((e) => e.isDirectory() && !beforeDirs.has(e.name))
        if (newDir) {
          fs.renameSync(join(destDir, newDir.name), model.dir)
        }
      }
      resolve()
    })
  })

  store.set('sttModel', model.id)
  initRecognizer()
  setOnFlushText((text) => {
    mainWindow?.webContents.send('stt:transcript', text)
    const file = getSessionTranscriptFile()
    if (file) fs.appendFileSync(file, `${text}\n`, 'utf-8')
  })
  mainWindow?.webContents.send('model:status', { ready: true })

  await downloadAuxModels()
  downloadRerankerModel().catch(() => {})

  return { ok: true }
})

// ── IPC: STT Model Selection ─────────────────────────────────────────────────

ipcMain.handle('stt:get-model', () => {
  return store.get('sttModel', 'parakeet') as string
})

ipcMain.handle('stt:set-model', (_e, model: SttModelType) => {
  store.set('sttModel', model)
  restartRecognizer()
  return { ok: true }
})

ipcMain.handle('stt:get-model-status', () => {
  return Object.fromEntries(STT_MODELS.map((m) => [m.id, m.isReady()]))
})

/** Return the model registry for the renderer (without functions) */
ipcMain.handle('stt:get-model-list', () => {
  return STT_MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    description: m.description,
    size: m.size,
    downloadMethod: m.downloadMethod,
    ready: m.isReady(),
  }))
})

ipcMain.handle('stt:download-whisper', async (_e, model: 'whisper-medium' | 'whisper-large-v3') => {
  const info = getSttModelInfo(model)
  if (info.isReady()) return { ok: true, alreadyDownloaded: true }

  const modelsDir = join(info.dir, '..')
  fs.mkdirSync(modelsDir, { recursive: true })
  const tarName = model === 'whisper-medium' ? 'whisper-medium.tar.bz2' : 'whisper-large-v3.tar.bz2'
  const tarPath = join(modelsDir, tarName)

  // Download with progress
  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(tarPath)
    const get = (url: string) => {
      https
        .get(url, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            return get(res.headers.location!)
          }
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))

          const total = Number.parseInt(res.headers['content-length'] || '0', 10)
          let downloaded = 0

          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length
            file.write(chunk)
            if (total > 0) {
              mainWindow?.webContents.send('stt:download-progress', {
                model,
                percent: Math.round((downloaded / total) * 100),
                downloadedMB: Math.round(downloaded / 1024 / 1024),
                totalMB: Math.round(total / 1024 / 1024),
              })
            }
          })
          res.on('end', () => file.close(() => resolve()))
          res.on('error', reject)
        })
        .on('error', reject)
    }
    get(info.url)
  })

  // Extract
  await new Promise<void>((resolve, reject) => {
    exec(`tar -xjf "${tarPath}" -C "${modelsDir}"`, (err) => {
      if (err) return reject(err)
      try {
        fs.unlinkSync(tarPath)
      } catch {
        /* non-fatal */
      }
      resolve()
    })
  })

  mainWindow?.webContents.send('stt:download-progress', { model, percent: 100, done: true })
  return { ok: true }
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
