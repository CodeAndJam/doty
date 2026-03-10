import { app, BrowserWindow, ipcMain, protocol, dialog, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { store } from './store'
import { QwenManager } from './qwen'
import { isModelReady, MODEL_URL, MODEL_DIR } from './model-paths'
import { initRecognizer, transcribeFloat32, freeRecognizer } from './asr'
import fs from 'fs'
import https from 'https'
import { exec } from 'child_process'

const qwen = new QwenManager()
let mainWindow: BrowserWindow | null = null
let transcriptBuffer = ''

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0f13',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../../index.html'))
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
  registerMusicProtocol()
  createWindow()

  const ready = isModelReady()
  mainWindow?.webContents.send('model:status', { ready })

  if (ready) {
    // Pre-load recognizer in background so first transcription is fast
    setTimeout(() => {
      try { initRecognizer() } catch (e) { console.error('ASR init error:', e) }
    }, 2000)
  }
})

app.on('before-quit', () => {
  freeRecognizer()
})

app.on('window-all-closed', () => {
  freeRecognizer()
  app.quit()
})

// ── IPC: STT ──────────────────────────────────────────────────────────────────
// Audio is recorded in the renderer via getUserMedia/AudioWorklet.
// The renderer sends Float32Array PCM chunks here for transcription.

ipcMain.handle('stt:start', () => ({ ok: true }))
ipcMain.handle('stt:stop', () => ({ ok: true }))

// Renderer sends a 5s PCM segment as a Float32Array buffer
ipcMain.handle('stt:transcribe-chunk', (_e, buffer: ArrayBuffer) => {
  try {
    const samples = new Float32Array(buffer)
    const text = transcribeFloat32(samples, 16000)
    if (text) {
      mainWindow?.webContents.send('stt:transcript', text)
      triggerRecommendation(text)
    }
    return { text }
  } catch (e) {
    console.error('Transcribe error:', e)
    return { text: '' }
  }
})

async function triggerRecommendation(newText: string) {
  transcriptBuffer = (transcriptBuffer + ' ' + newText).slice(-2000)
  const musicFolder = store.get('musicFolder', '') as string
  if (!musicFolder) return

  try {
    const files = fs.readdirSync(musicFolder).filter((f) =>
      /\.(mp3|flac|wav|m4a|ogg|aac)$/i.test(f)
    )
    if (files.length === 0) return
    const recommendations = await qwen.recommend(transcriptBuffer, files)
    mainWindow?.webContents.send('music:recommendations', recommendations)
  } catch (e) {
    console.error('Recommendation error:', e)
  }
}

// ── IPC: Music ────────────────────────────────────────────────────────────────

ipcMain.handle('music:set-folder', (_e, folderPath: string) => {
  store.set('musicFolder', folderPath)
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
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('music:list', () => {
  const musicFolder = store.get('musicFolder', '') as string
  if (!musicFolder) return []
  try {
    return fs.readdirSync(musicFolder).filter((f) =>
      /\.(mp3|flac|wav|m4a|ogg|aac)$/i.test(f)
    )
  } catch { return [] }
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
