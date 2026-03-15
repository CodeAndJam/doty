import fs from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { DENOISER_MODEL_PATH, MODEL_DIR, VAD_MODEL_PATH } from './model-paths'
import { store } from './store'

const WORKER_PATH = join(__dirname, 'asr-worker.js')

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

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(WORKER_PATH, {
    workerData: {
      modelDir: MODEL_DIR,
      vadModelPath: VAD_MODEL_PATH,
      hotwordsFile: resolveHotwordsFile(),
      denoiserModelPath: DENOISER_MODEL_PATH,
    },
  })

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
