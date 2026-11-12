/**
 * asr.ts — Unified ASR interface using transcribe-cpp.
 * Single worker thread, streaming-first. Replaces the old sherpa-onnx + voxtral + voxmlx split.
 */
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { DEFAULT_STT_LANGUAGE, DEFAULT_STT_MODEL, getModelPath, STT_MODELS, type SttModelType } from './model-paths'
import { store } from './store'
import { AudioQueue } from './stt-quality/audio-queue'

const WORKER_PATH = join(__dirname, 'transcribe-worker.js')

let worker: Worker | null = null
let workerReady = false
let streaming = false
let streamStarted = false
// Audio captured while the model is still loading: a cold Metal load is ~10s
// and the first words of the session must not be lost.
const pending = new AudioQueue(60) // ~30s of 500ms chunks

function postChunk(samples: Float32Array): void {
  if (!worker) return
  const buf = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength)
  worker.postMessage({ type: 'feed', buffer: buf }, [buf])
}

/** Tell the worker to start a session, then replay whatever audio was queued. */
function beginWorkerStream(): void {
  if (!worker || !streaming || streamStarted) return
  streamStarted = true
  worker.postMessage({ type: 'stream-start' })
  for (const samples of pending.drain()) postChunk(samples)
}

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

  const w = new Worker(WORKER_PATH)
  worker = w

  w.on('message', (msg: any) => {
    switch (msg.type) {
      case 'ready':
        workerReady = true
        // Persist the effective language so Settings never claims a focus the model rejected.
        if (typeof msg.language === 'string') store.set('sttLanguage', msg.language)
        if (onAsrStatus) onAsrStatus('ready')
        beginWorkerStream()
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

  w.on('error', (e) => {
    console.error('[asr] worker thread error:', e)
    // A terminated worker's exit can arrive after a replacement was created;
    // only clear state that still belongs to this instance.
    if (worker === w) {
      worker = null
      workerReady = false
    }
    if (onAsrStatus) onAsrStatus('crashed')
  })

  w.on('exit', () => {
    if (worker !== w) return
    worker = null
    workerReady = false
  })

  return w
}

/** Initialize the recognizer: load the selected model in the worker.
 * @returns false when no speech model is downloaded (no worker started). */
export function initRecognizer(): boolean {
  const modelId = store.get('sttModel', DEFAULT_STT_MODEL) as SttModelType
  const model = STT_MODELS.find((m) => m.id === modelId)
  if (!model?.isReady()) {
    // The background downloader (#100) will pick this up; until then there is
    // nothing to load, so do not leave a half-started worker polling forever.
    console.warn(`[asr] model ${modelId} is not downloaded yet`)
    if (onAsrStatus) onAsrStatus('no-model')
    return false
  }
  const language = store.get('sttLanguage', DEFAULT_STT_LANGUAGE) as string
  const w = ensureWorker()
  w.postMessage({ type: 'load', modelPath: getModelPath(model.id), language })
  return true
}

/** Start a streaming session. Ensures worker is initialized and model is loaded. */
export function startStream(): void {
  streaming = true
  streamStarted = false
  pending.clear()
  if (!worker && !initRecognizer()) {
    streaming = false
    return
  }
  if (workerReady) {
    beginWorkerStream()
    return
  }
  // Model still loading: keep the audio and replay it once the worker is ready.
  const startedAt = Date.now()
  const waitAndStart = () => {
    if (!streaming) return
    if (workerReady) {
      beginWorkerStream()
    } else if (!worker || Date.now() - startedAt > 60_000) {
      streaming = false
      if (onAsrStatus) onAsrStatus('error')
    } else {
      setTimeout(waitAndStart, 50)
    }
  }
  waitAndStart()
}

/** Feed a PCM chunk to the active stream (Float32Array, 16kHz mono) */
export function feedChunk(samples: Float32Array): void {
  if (!streaming) return
  if (!streamStarted) {
    pending.push(samples)
    return
  }
  postChunk(samples)
}

/** Finalize the stream — flush remaining audio and get final text */
export function finalizeStream(): void {
  const started = streamStarted
  streaming = false
  streamStarted = false
  pending.clear()
  if (!worker || !started) return
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
