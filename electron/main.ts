import { app, BrowserWindow, ipcMain, protocol, dialog, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { store } from './store'
import { isModelReady, MODEL_URL, MODEL_DIR } from './model-paths'
import { initRecognizer, transcribeFloat32, freeRecognizer } from './asr'
import { startScanner, stopScanner, getMetadata, getAllMetadata } from './scanner'
import fs from 'fs'
import https from 'https'
import { exec } from 'child_process'

// Register app:// as a privileged scheme BEFORE app is ready.
// This makes the renderer a secure context (like https://) so the Cache API
// is available — transformers.js uses it to cache model weights between launches.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'music', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
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

function registerMusicProtocol() {
  protocol.handle('music', (request) => {
    const musicFolder = store.get('musicFolder', '') as string
    // With music:// as a standard scheme, URLs are parsed like http://
    // music://play/Campfire.mp3 → host='play', pathname='/Campfire.mp3'
    const url = new URL(request.url)
    const filename = decodeURIComponent(url.pathname.slice(1)) // remove leading /
    const filePath = join(musicFolder, filename)
    const fileUrl = pathToFileURL(filePath).toString()
    const exists = fs.existsSync(filePath)
    console.log('[music] request:', request.url)
    console.log('[music] parsed pathname:', url.pathname, '→ filename:', filename)
    console.log('[music] resolved:', filePath, '| exists:', exists)
    return net.fetch(fileUrl)
  })
}

app.whenReady().then(async () => {
  registerAppProtocol()
  registerMusicProtocol()
  createWindow()

  const ready = isModelReady()
  mainWindow?.webContents.send('model:status', { ready })

  if (ready) {
    setTimeout(() => {
      try { initRecognizer() } catch (e) { console.error('ASR init error:', e) }
    }, 2000)
  }

  const musicFolder = store.get('musicFolder', '') as string
  if (musicFolder) launchScanner(musicFolder)
})

app.on('before-quit', () => {
  freeRecognizer()
  stopScanner()
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

// Renderer sends a 5s PCM segment as a Float32Array buffer.
// Transcription result is sent back via 'stt:transcript' — the renderer
// accumulates it and triggers recommendations via the Web Worker.
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
  mainWindow?.webContents.send('model:status', { ready: true })
  return { ok: true }
})
