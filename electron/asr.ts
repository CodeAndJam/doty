/**
 * asr.ts — Unified ASR interface using transcribe-cpp.
 * Single worker thread, streaming-first. Replaces the old sherpa-onnx + voxtral + voxmlx split.
 */
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { getModelPath, type SttModelType } from './model-paths'
import { store } from './store'

const WORKER_PATH = join(__dirname, 'transcribe-worker.js')

let worker: Worker | null = null
let workerReady = false
let streaming = false

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

function ensureWorker(): Worker {
  if (worker) return worker

  worker = new Worker(WORKER_PATH)

  worker.on('message', (msg: any) => {
    switch (msg.type) {
      case 'ready':
        workerReady = true
        if (onAsrStatus) onAsrStatus('ready')
        break
      case 'text':
        // Streaming update — committed is the stable delta since last flush,
        // tentative may still change. Show both as the live "typing" view.
        if (onInterimText) {
          const live = (msg.committed || '') + (msg.tentative || '')
          if (live) onInterimText(live)
        }
        break
      case 'flush':
        // Finalized segment text (delta since previous flush) — append to session
        if (msg.text && onFlushText) onFlushText(msg.text)
        break
      case 'status':
        if (onAsrStatus) onAsrStatus(msg.status)
        break
      case 'error':
        console.error('[asr] worker error:', msg.error)
        if (onAsrStatus) onAsrStatus('error')
        break
    }
  })

  worker.on('error', (e) => {
    console.error('[asr] worker thread error:', e)
    worker = null
    workerReady = false
    if (onAsrStatus) onAsrStatus('crashed')
  })

  worker.on('exit', () => {
    worker = null
    workerReady = false
  })

  return worker
}

/** Initialize the recognizer: load the selected model in the worker */
export function initRecognizer(): void {
  const modelId = store.get('sttModel', 'parakeet-unified-en') as SttModelType
  const modelPath = getModelPath(modelId)
  const w = ensureWorker()
  w.postMessage({ type: 'load', modelPath })
}

/** Start a streaming session */
export function startStream(): void {
  if (!workerReady) return
  streaming = true
  worker!.postMessage({ type: 'stream-start' })
}

/** Feed a PCM chunk to the active stream (Float32Array, 16kHz mono) */
export function feedChunk(samples: Float32Array): void {
  if (!worker || !streaming) return
  const buf = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength)
  worker.postMessage({ type: 'feed', buffer: buf }, [buf])
}

/** Finalize the stream — flush remaining audio and get final text */
export function finalizeStream(): void {
  if (!worker || !streaming) return
  streaming = false
  worker.postMessage({ type: 'finalize' })
}

/**
 * Legacy compatibility: transcribe a chunk.
 * In streaming mode, feeds the chunk. Otherwise batch-transcribes.
 */
export function transcribeFloat32(samples: Float32Array, _sampleRate = 16000): Promise<string> {
  return new Promise((resolve) => {
    if (!worker) {
      resolve('')
      return
    }

    if (streaming) {
      // In streaming mode, just feed and resolve empty (text comes via callbacks)
      feedChunk(samples)
      resolve('')
    } else {
      // Batch mode fallback
      const id = Date.now() + Math.random()
      const handler = (msg: any) => {
        if (msg.type === 'result' && msg.id === id) {
          worker!.off('message', handler)
          resolve(msg.text ?? '')
        }
      }
      worker.on('message', handler)
      const buf = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength)
      worker.postMessage({ type: 'transcribe', id, buffer: buf }, [buf])
    }
  })
}

/** Flush recognizer — finalize the stream */
export function flushRecognizer(): void {
  finalizeStream()
}

/** Restart with potentially different model */
export function restartRecognizer(): void {
  if (worker) {
    worker.postMessage({ type: 'dispose' })
    // Give it a moment then reinit
    setTimeout(() => {
      worker?.terminate()
      worker = null
      workerReady = false
      streaming = false
      initRecognizer()
    }, 200)
  } else {
    initRecognizer()
  }
}

/** Free the worker */
export function freeRecognizer(): void {
  if (worker) {
    worker.postMessage({ type: 'dispose' })
    // Don't call terminate immediately — let Metal clean up
    setTimeout(() => {
      worker?.terminate()
      worker = null
      workerReady = false
      streaming = false
    }, 500)
  }
}
