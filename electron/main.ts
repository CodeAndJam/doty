import { app, BrowserWindow, ipcMain, protocol, dialog, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { store } from './store'
import { QwenManager, onQwenStatus, killQwenChild } from './qwen'
import { isModelReady, MODEL_URL, MODEL_DIR } from './model-paths'
import { initRecognizer, transcribeFloat32, freeRecognizer } from './asr'
import { startScanner, stopScanner, forceRescan, getMetadata } from './scanner'
import { getCache } from './metadata-cache'
import fs from 'fs'
import https from 'https'
import { exec } from 'child_process'

// Register app:// as a privileged scheme BEFORE app is ready.
// This makes the renderer a secure context (like https://) so the Cache API
// is available — transformers.js uses it to cache model weights between launches.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
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

const qwen = new QwenManager()
let mainWindow: BrowserWindow | null = null
let transcriptBuffer = ''
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
    const filename = decodeURIComponent(request.url.slice('music://'.length))
    const filePath = join(musicFolder, filename)
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

app.whenReady().then(async () => {
  registerAppProtocol()
  registerMusicProtocol()
  createWindow()

  onQwenStatus((status) => {
    mainWindow?.webContents.send('qwen:status', { status })
  })

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
  killQwenChild()
})

app.on('window-all-closed', () => {
  freeRecognizer()
  app.quit()
})

// ── IPC: STT ──────────────────────────────────────────────────────────────────
// Audio is recorded in the renderer via getUserMedia/AudioWorklet.
// The renderer sends Float32Array PCM chunks here for transcription.

ipcMain.handle('stt:start', () => {
  sessionTranscriptFile = null // new session → new file
  return { ok: true }
})
ipcMain.handle('stt:stop', () => ({ ok: true }))

// Renderer sends a 5s PCM segment as a Float32Array buffer
ipcMain.handle('stt:transcribe-chunk', async (_e, buffer: ArrayBuffer) => {
  try {
    const samples = new Float32Array(buffer)
    const text = await transcribeFloat32(samples, 16000)
    if (text) {
      mainWindow?.webContents.send('stt:transcript', text)
      triggerRecommendation(text)
      const file = getSessionTranscriptFile()
      if (file) fs.appendFileSync(file, text + '\n', 'utf-8')
    }
    return { text }
  } catch (e) {
    console.error('Transcribe error:', e)
    return { text: '' }
  }
})

let recommendDebounce: ReturnType<typeof setTimeout> | null = null
let isRecommending = false
let pendingAfterRun = false

function triggerRecommendation(newText: string) {
  transcriptBuffer = (transcriptBuffer + ' ' + newText).slice(-2000)

  if (isRecommending) {
    // A run is in progress — flag so it re-runs when done
    pendingAfterRun = true
    return
  }

  if (recommendDebounce) clearTimeout(recommendDebounce)
  recommendDebounce = setTimeout(runRecommendation, 300)
}

async function runRecommendation() {
  const musicFolder = store.get('musicFolder', '') as string
  if (!musicFolder) { console.log('[main] runRecommendation: no music folder set'); return }

  isRecommending = true
  pendingAfterRun = false
  try {
    const files = listMusicFiles(musicFolder)
    console.log(`[main] runRecommendation: ${files.length} files, transcript length=${transcriptBuffer.length}`)
    if (files.length === 0) return
    const metadata = getCache()
    console.log('[main] calling qwen.recommend...')
    const recommendations = await qwen.recommend(transcriptBuffer, files, metadata)
    console.log('[main] recommendations:', recommendations)
    mainWindow?.webContents.send('music:recommendations', recommendations)
  } catch (e) {
    console.error('Recommendation error:', e)
  } finally {
    isRecommending = false
    if (pendingAfterRun) {
      pendingAfterRun = false
      runRecommendation()
    }
  }
}

ipcMain.handle('music:recommend-manual', async (_e, prompt: string) => {
  const musicFolder = store.get('musicFolder', '') as string
  console.log(`[main] recommend-manual: prompt="${prompt}", folder="${musicFolder}"`)
  if (!musicFolder) return { ok: false }
  const files = listMusicFiles(musicFolder)
  console.log(`[main] recommend-manual: ${files.length} files`)
  if (files.length === 0) return { ok: false }
  const metadata = getCache()
  const combined = [transcriptBuffer, prompt].filter(Boolean).join('\n\nDM note: ')
  console.log('[main] recommend-manual: calling qwen.recommend...')
  const recommendations = await qwen.recommend(combined, files, metadata)
  console.log('[main] recommend-manual: result:', recommendations)
  mainWindow?.webContents.send('music:recommendations', recommendations)
  return { ok: true }
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
