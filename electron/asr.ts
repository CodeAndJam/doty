import { join } from 'path'
import { Worker } from 'worker_threads'
import { MODEL_DIR, VAD_MODEL_PATH, DENOISER_MODEL_PATH, PUNCT_MODEL_PATH } from './model-paths'
import { store } from './store'
import fs from 'fs'

const WORKER_PATH = join(__dirname, 'asr-worker.js')

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>()

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
      punctModelPath: PUNCT_MODEL_PATH,
    },
  })

  worker.on('message', ({ id, text, error }: { id: number; text?: string; error?: string }) => {
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    if (error) p.reject(new Error(error))
    else p.resolve(text ?? '')
  })

  worker.on('error', (e) => {
    for (const p of pending.values()) p.reject(e)
    pending.clear()
    worker = null
  })

  worker.on('exit', () => { worker = null })

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
