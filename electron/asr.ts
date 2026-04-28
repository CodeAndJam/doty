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
const VOXTRAL_CHILD_PATH = join(__dirname, 'voxtral-child.js')

/** Abstraction over Worker thread and utilityProcess */
interface AsrProcess {
  postMessage(msg: unknown, transfer?: ArrayBuffer[]): void
  terminate(): void
  onMessage(cb: (msg: any) => void): void
  onError(cb: (e: Error) => void): void
  onExit(cb: () => void): void
}

let asrProcess: AsrProcess | null = null
let nextId = 0
const pending = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>()

let onFlushText: ((text: string) => void) | null = null
let onInterimText: ((text: string) => void) | null = null
let onAsrStatus: ((status: string) => void) | null = null

export function setOnFlushText(cb: (text: string) => void): void {
  onFlushText = cb
}

export function setOnInterimText(cb: (text: string) => void): void {
  onInterimText = cb
}

export function setOnAsrStatus(cb: (status: string) => void): void {
  onAsrStatus = cb
}

function resolveHotwordsFile(): string | null {
  const custom = store.get('hotwordsFile', '') as string
  if (custom && fs.existsSync(custom)) return custom
  return null
}

function resolveModelDir(): { modelDir: string; sttModel: SttModelType } {
  const sttModel = (store.get('sttModel', 'parakeet') as SttModelType) || 'parakeet'
  switch (sttModel) {
    case 'whisper-medium':
      return { modelDir: WHISPER_MEDIUM_DIR, sttModel }
    case 'whisper-large-v3':
      return { modelDir: WHISPER_LARGE_V3_DIR, sttModel }
    case 'voxtral':
      return { modelDir: '', sttModel }
    default:
      return { modelDir: MODEL_DIR, sttModel: 'parakeet' }
  }
}

function createWorkerProcess(modelDir: string, sttModel: SttModelType): AsrProcess {
  const w = new Worker(WORKER_PATH, {
    workerData: {
      modelDir,
      sttModel,
      vadModelPath: VAD_MODEL_PATH,
      hotwordsFile: resolveHotwordsFile(),
      denoiserModelPath: DENOISER_MODEL_PATH,
    },
  })
  return {
    postMessage: (msg, transfer) => w.postMessage(msg, transfer ?? []),
    terminate: () => w.terminate(),
    onMessage: (cb) => w.on('message', cb),
    onError: (cb) => w.on('error', cb),
    onExit: (cb) => w.on('exit', cb),
  }
}

function createVoxtralProcess(): AsrProcess {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { utilityProcess } = require('electron')
  const child = utilityProcess.fork(VOXTRAL_CHILD_PATH, [], {
    serviceName: 'voxtral-asr',
  })
  let spawned = false
  const pendingMessages: unknown[] = []
  child.on('spawn', () => {
    console.log('[asr] voxtral utilityProcess spawned')
    spawned = true
    for (const msg of pendingMessages) child.postMessage(msg)
    pendingMessages.length = 0
  })
  return {
    postMessage: (msg) => {
      if (spawned) child.postMessage(msg)
      else pendingMessages.push(msg)
    },
    terminate: () => child.kill(),
    onMessage: (cb) => child.on('message', cb),
    onError: () => {},
    onExit: (cb) => child.on('exit', cb),
  }
}

function getProcess(): AsrProcess {
  if (asrProcess) return asrProcess

  const { modelDir, sttModel } = resolveModelDir()

  if (sttModel === 'voxtral') {
    asrProcess = createVoxtralProcess()
  } else {
    asrProcess = createWorkerProcess(modelDir, sttModel)
  }

  asrProcess.onMessage((msg: { type?: string; id?: number; text?: string; error?: string; status?: string }) => {
    if (msg.type === 'flush') {
      if (msg.text && onFlushText) onFlushText(msg.text)
      return
    }
    if (msg.type === 'interim') {
      if (msg.text && onInterimText) onInterimText(msg.text)
      return
    }
    if (msg.type === 'status') {
      if (onAsrStatus) onAsrStatus(msg.status ?? '')
      return
    }

    const p = pending.get(msg.id!)
    if (!p) return
    pending.delete(msg.id!)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.text ?? '')
  })

  asrProcess.onError((e) => {
    for (const p of pending.values()) p.reject(e)
    pending.clear()
    asrProcess = null
  })

  asrProcess.onExit(() => {
    asrProcess = null
  })

  return asrProcess
}

export function initRecognizer(): void {
  getProcess()
}

export function transcribeFloat32(samples: Float32Array, sampleRate = 16000): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    const buf = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) as ArrayBuffer
    getProcess().postMessage({ id, buffer: buf, sampleRate }, [buf])
  })
}

export function restartRecognizer(): void {
  if (asrProcess) {
    asrProcess.terminate()
    asrProcess = null
    pending.clear()
  }
  getProcess()
}

export function freeRecognizer(): void {
  asrProcess?.terminate()
  asrProcess = null
  pending.clear()
}
