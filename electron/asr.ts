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

let onFlushText: ((text: string, elapsedMs: number) => void) | null = null
let onInterimText: ((text: string) => void) | null = null
let onAsrStatus: ((status: string) => void) | null = null
let onParagraphBreak: (() => void) | null = null

export function setOnFlushText(cb: (text: string, elapsedMs: number) => void): void {
  onFlushText = cb
}
export function setOnInterimText(cb: (text: string) => void): void {
  onInterimText = cb
}
export function setOnAsrStatus(cb: (status: string) => void): void {
  onAsrStatus = cb
}
export function setOnParagraphBreak(cb: () => void): void {
  onParagraphBreak = cb
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
        if (msg.text && onFlushText) onFlushText(msg.text, msg.elapsedMs ?? 0)
        break
      case 'paragraph-break':
        if (onParagraphBreak) onParagraphBreak()
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

/** Start a streaming session. Ensures worker is initialized and model is loaded. */
export function startStream(): void {
  if (!worker) {
    // No worker yet — init first, then start stream once ready
    initRecognizer()
  }
  if (!workerReady) {
    // Model still loading — wait then start
    const waitAndStart = () => {
      if (workerReady && worker) {
        streaming = true
        worker.postMessage({ type: 'stream-start' })
      } else {
        setTimeout(waitAndStart, 50)
      }
    }
    waitAndStart()
    return
  }
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

/** Restart with potentially different model. Seamlessly resumes streaming if active. */
export function restartRecognizer(): void {
  const wasStreaming = streaming

  if (worker) {
    // Finalize current stream to flush pending text before switching
    if (streaming) {
      worker.postMessage({ type: 'finalize' })
      streaming = false
    }
    worker.postMessage({ type: 'dispose' })
    setTimeout(() => {
      worker?.terminate()
      worker = null
      workerReady = false
      initRecognizer()
      // Re-start streaming once new model is ready
      if (wasStreaming) {
        const waitForReady = () => {
          if (workerReady) {
            startStream()
          } else {
            setTimeout(waitForReady, 50)
          }
        }
        waitForReady()
      }
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
