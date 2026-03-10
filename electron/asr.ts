import { join } from 'path'
import { Worker } from 'worker_threads'
import { MODEL_DIR } from './model-paths'

const WORKER_PATH = join(__dirname, 'asr-worker.js')

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(WORKER_PATH, { workerData: { modelDir: MODEL_DIR } })

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
    const buffer = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength)
    getWorker().postMessage({ id, buffer, sampleRate }, [buffer])
  })
}

export function freeRecognizer(): void {
  worker?.terminate()
  worker = null
  pending.clear()
}
