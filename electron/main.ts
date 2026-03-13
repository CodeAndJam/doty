import { app, BrowserWindow, ipcMain, protocol, dialog, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { store } from './store'
import {
  isModelReady, isRerankerCached, MODEL_URL, MODEL_DIR,
  VAD_MODEL_URL, VAD_MODEL_PATH, isVadReady,
  DENOISER_MODEL_URL, DENOISER_MODEL_PATH, isDenoiserReady,
  PUNCT_MODEL_URL, PUNCT_MODEL_DIR, isPunctReady,
  DEFAULT_HOTWORDS_PATH,
} from './model-paths'
import { initRecognizer, transcribeFloat32, freeRecognizer, restartRecognizer, setOnFlushText } from './asr'
import { startScanner, stopScanner, getMetadata, getAllMetadata } from './scanner'
import { getDb, closeDb, getTags, setTags, getAllTags, getTagsMap } from './database'
import { migrateFromJson } from './metadata-cache'
import fs from 'fs'
import https from 'https'
import { exec } from 'child_process'

// ── Download helper ───────────────────────────────────────────────────────────
/** Download a file from a URL (follows redirects). Ensures parent dir exists. */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(join(destPath, '..'), { recursive: true })
    const file = fs.createWriteStream(destPath)
    const get = (u: string) => {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return get(res.headers.location!)
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${u}`))
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        res.on('error', reject)
      }).on('error', reject)
    }
    get(url)
  })
}

/** Download a tar.bz2 archive, extract it, and optionally rename the extracted dir. */
async function downloadAndExtractTarBz2(url: string, destDir: string, extractedName?: string, finalDir?: string): Promise<void> {
  const tarPath = join(destDir, 'download.tar.bz2')
  fs.mkdirSync(destDir, { recursive: true })
  await downloadFile(url, tarPath)
  await new Promise<void>((resolve, reject) => {
    exec(`tar -xjf "${tarPath}" -C "${destDir}"`, (err) => {
      if (err) return reject(err)
      // Rename extracted directory if needed
      if (extractedName && finalDir) {
        const extracted = join(destDir, extractedName)
        if (fs.existsSync(extracted) && extracted !== finalDir) {
          fs.renameSync(extracted, finalDir)
        }
      }
      try { fs.unlinkSync(tarPath) } catch { /* ignore */ }
      resolve()
    })
  })
}

/** Download all auxiliary STT models (VAD, denoiser, punctuation) if not present. Non-fatal. */
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

  // CT-Transformer punctuation model (~100MB tar.bz2)
  if (!isPunctReady()) {
    try {
      const modelsDir = join(PUNCT_MODEL_DIR, '..')
      await downloadAndExtractTarBz2(
        PUNCT_MODEL_URL,
        modelsDir,
        'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12',
        PUNCT_MODEL_DIR,
      )
      console.log('[main] CT-Transformer punctuation model downloaded')
    } catch (e) {
      console.error('[main] Punctuation model download failed (non-fatal):', e)
    }
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
  } catch { /* skip unreadable dirs */ }
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
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0f13',
    titleBarStyle: 'hiddenInset',
    icon: join(__dirname, '../../build/icon.png'),
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
    '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav',
    '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.aac': 'audio/aac',
  }
  return map[ext.toLowerCase()] ?? 'application/octet-stream'
}

function registerMusicProtocol() {
  protocol.handle('music', (request) => {
    try {
    const musicFolder = store.get('musicFolder', '') as string
    const raw = request.url
    const prefix = 'music://play/'
    const filename = decodeURIComponent(raw.startsWith(prefix) ? raw.slice(prefix.length) : raw.slice('music://'.length))
    const filePath = join(musicFolder, filename)

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
              try { controller.enqueue(chunk) } catch { closed = true; nodeStream.destroy() }
            }
          })
          nodeStream.on('end', () => {
            if (!closed) { closed = true; try { controller.close() } catch { /* already closed */ } }
          })
          nodeStream.on('error', (err) => {
            if (!closed) { closed = true; try { controller.error(err) } catch { /* already errored */ } }
          })
        },
        cancel() { closed = true; nodeStream.destroy() },
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
      const end = match && match[2] ? parseInt(match[2], 10) : total - 1

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

  const ready = isModelReady()
  mainWindow?.webContents.send('model:status', { ready })

  if (ready) {
    // Download auxiliary STT models (VAD, denoiser, punctuation) if not present
    await downloadAuxModels()

    setTimeout(() => {
      try {
        initRecognizer()
        // Forward VAD flush text to renderer (sentence tails after silence)
        setOnFlushText((text) => {
          mainWindow?.webContents.send('stt:transcript', text)
          const file = getSessionTranscriptFile()
          if (file) fs.appendFileSync(file, text + '\n', 'utf-8')
        })
      } catch (e) { console.error('ASR init error:', e) }
    }, 2000)
  }

  const musicFolder = store.get('musicFolder', '') as string
  if (musicFolder) launchScanner(musicFolder)
})

app.on('before-quit', () => {
  freeRecognizer()
  stopScanner()
  closeDb()
})

app.on('window-all-closed', () => {
  freeRecognizer()
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
      if (file) fs.appendFileSync(file, text + '\n', 'utf-8')
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

ipcMain.handle('model:status', () => ({ ready: isModelReady() }))

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
  try { restartRecognizer() } catch (e) { console.error('ASR restart error:', e) }
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
    try { restartRecognizer() } catch (e) { console.error('ASR restart error:', e) }
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

ipcMain.handle('model:download', async () => {
  fs.mkdirSync(join(MODEL_DIR, '..'), { recursive: true })
  const tarPath = join(MODEL_DIR, '..', 'parakeet-v3-int8.tar.bz2')

  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(tarPath)
    const get = (url: string) => {
      https.get(url, (res) => {
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
      }).on('error', reject)
    }
    get(MODEL_URL)
  })

  await new Promise<void>((resolve, reject) => {
    const destDir = join(MODEL_DIR, '..')
    exec(`tar -xjf "${tarPath}" -C "${destDir}"`, (err) => {
      if (err) return reject(err)
      const extracted = join(destDir, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8')
      if (fs.existsSync(extracted) && extracted !== MODEL_DIR) {
        fs.renameSync(extracted, MODEL_DIR)
      }
      fs.unlinkSync(tarPath)
      resolve()
    })
  })

  initRecognizer()
  // Forward VAD flush text to renderer (sentence tails after silence)
  setOnFlushText((text) => {
    mainWindow?.webContents.send('stt:transcript', text)
    const file = getSessionTranscriptFile()
    if (file) fs.appendFileSync(file, text + '\n', 'utf-8')
  })
  mainWindow?.webContents.send('model:status', { ready: true })

  // Download auxiliary STT models (VAD, denoiser, punctuation)
  await downloadAuxModels()

  return { ok: true }
})
