import fs from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  DENOISER_MODEL_PATH,
  MODEL_DIR,
  type SttModelType,
  VAD_MODEL_PATH,
  WHISPER_LARGE_V3_DIR,
  WHISPER_MEDIUM_DIR,
} from './model-paths'
import { store } from './store'

const WORKER_PATH = join(__dirname, 'asr-worker.js')
const VOXTRAL_WORKER_PATH = join(__dirname, 'voxtral-worker.js')

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>()

/** Callback for flushed transcript text (VAD silence flush). Set by main process. */
let onFlushText: ((text: string) => void) | null = null

export function setOnFlushText(cb: (text: string) => void): void {
  onFlushText = cb
}
function resolveHotwordsFile(): string | null {
  const custom = store.get('hotwordsFile', '') as string
  if (custom && fs.existsSync(custom)) return custom
  return null
}

/** Resolve the model directory for the selected STT model */
function resolveModelDir(): { modelDir: string; sttModel: SttModelType } {
  const sttModel = (store.get('sttModel', 'parakeet') as SttModelType) || 'parakeet'
  switch (sttModel) {
    case 'whisper-medium':
      return { modelDir: WHISPER_MEDIUM_DIR, sttModel }
    case 'whisper-large-v3':
      return { modelDir: WHISPER_LARGE_V3_DIR, sttModel }
    case 'voxtral':
      return { modelDir: '', sttModel } // model dir managed by transformers.js cache
    default:
      return { modelDir: MODEL_DIR, sttModel: 'parakeet' }
  }
}

function getWorker(): Worker {
  if (worker) return worker

  const { modelDir, sttModel } = resolveModelDir()

  if (sttModel === 'voxtral') {
    // Voxtral uses transformers.js, not sherpa-onnx
    const appPath = require('node:path').resolve(__dirname, '..')
    const homePath = require('electron').app.getPath('home')
    worker = new Worker(VOXTRAL_WORKER_PATH, {
      workerData: { appPath, homePath },
    })
  } else {
    worker = new Worker(WORKER_PATH, {
      workerData: {
        modelDir,
        sttModel,
        vadModelPath: VAD_MODEL_PATH,
        hotwordsFile: resolveHotwordsFile(),
        denoiserModelPath: DENOISER_MODEL_PATH,
      },
    })
  }

  worker.on('message', (msg: { type?: string; id?: number; text?: string; error?: string }) => {
    // Handle VAD flush messages (no pending promise, forward directly)
    if (msg.type === 'flush') {
      if (msg.text && onFlushText) onFlushText(msg.text)
      return
    }

    const p = pending.get(msg.id!)
    if (!p) return
    pending.delete(msg.id!)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.text ?? '')
  })

  worker.on('error', (e) => {
    for (const p of pending.values()) p.reject(e)
    pending.clear()
    worker = null
  })

  worker.on('exit', () => {
    worker = null
  })

  return worker
}

export function initRecognizer(): void {
  getWorker() // warm up
}

export function transcribeFloat32(samples: Float32Array, sampleRate = 16000): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    const buf = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength)
    getWorker().postMessage({ id, buffer: buf, sampleRate }, [buf as ArrayBuffer])
  })
}

/** Restart the worker to pick up new hotwords config */
export function restartRecognizer(): void {
  if (worker) {
    worker.terminate()
    worker = null
    pending.clear()
  }
  getWorker()
}

export function freeRecognizer(): void {
  worker?.terminate()
  worker = null
  pending.clear()
}
