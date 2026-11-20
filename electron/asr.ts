/**
 * asr.ts — Unified ASR interface using transcribe-cpp.
 * Single worker thread, streaming-first. Replaces the old sherpa-onnx + voxtral + voxmlx split.
 */
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  DEFAULT_STT_LANGUAGE,
  DEFAULT_STT_MODEL,
  getModelPath,
  getSttSideModelPath,
  STT_MODELS,
  type SttModelType,
} from './model-paths'
import { store } from './store'
import { AudioQueue } from './stt-quality/audio-queue'

const WORKER_PATH = join(__dirname, 'transcribe-worker.js')

let worker: Worker | null = null
let workerReady = false
let streaming = false
let streamStarted = false
/** Incremented on every stop so a pending model switch knows the user stopped. */
let stopToken = 0
/** True while a model/language switch is replacing the worker. */
let restarting = false
// Audio captured while the model is still loading: a cold Metal load is ~10s
// and the first words of the session must not be lost.
const pending = new AudioQueue(60) // ~30s of 500ms chunks
/** A cold Metal load is ~10 s; a worker that has not said `ready` by then is not coming. */
const READY_TIMEOUT_MS = 60_000

/**
 * One readiness signal for the worker. Both the first start and a model switch
 * wait on it instead of polling `workerReady` on a timer, and a worker that
 * dies or never loads settles it false once.
 */
let readiness: {
  promise: Promise<boolean>
  resolve: (ready: boolean) => void
  timer: ReturnType<typeof setTimeout>
} | null = null

function armReadiness(): Promise<boolean> {
  if (workerReady) return Promise.resolve(true)
  if (readiness) return readiness.promise
  let resolve!: (ready: boolean) => void
  const promise = new Promise<boolean>((done) => {
    resolve = done
  })
  const timer = setTimeout(() => settleReadiness(false), READY_TIMEOUT_MS)
  readiness = { promise, resolve, timer }
  return promise
}

/**
 * Bumped whenever the worker is replaced. A waiter armed before the switch must
 * not report the new worker's load as a failure.
 */
let readinessGeneration = 0

function settleReadiness(ready: boolean): void {
  const signal = readiness
  if (!signal) return
  readiness = null
  clearTimeout(signal.timer)
  signal.resolve(ready)
}

/** Start the stream once the worker is ready, or report that it never was. */
function beginWhenReady(): void {
  const token = stopToken
  const generation = readinessGeneration
  void armReadiness().then((ready) => {
    if (token !== stopToken || generation !== readinessGeneration || !streaming) return
    if (ready) {
      beginWorkerStream()
      return
    }
    // A worker that never loaded is not a session any more: stop taking audio.
    streaming = false
    if (onAsrStatus) onAsrStatus('error')
  })
}

function postChunk(samples: Float32Array): void {
  if (!worker) return
  const buf = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) as ArrayBuffer
  worker.postMessage({ type: 'feed', buffer: buf }, [buf])
}

/** Tell the worker to start a session, then replay whatever audio was queued. */
function beginWorkerStream(): void {
  if (restarting || !worker || !streaming || streamStarted) return
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
        restarting = false
        settleReadiness(true)
        // Persist the effective language so Settings never claims a focus the model
        // rejected — but never over a language the DM chose. A mis-detected
        // language used to stick and outlived the session.
        if (typeof msg.language === 'string' && store.get('sttLanguage', 'auto') === 'auto') {
          store.set('sttLanguage', msg.language)
        }
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
        restarting = false
        settleReadiness(false)
        if (streaming && !streamStarted) {
          // The load failed before the stream began: do not leave the UI recording
          streaming = false
          pending.clear()
        }
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
      restarting = false
      settleReadiness(false)
    }
    if (onAsrStatus) onAsrStatus('crashed')
  })

  w.on('exit', () => {
    if (worker !== w) return
    worker = null
    workerReady = false
    restarting = false
    settleReadiness(false)
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
  // The VAD model is optional: without it the worker keeps the level gate.
  w.postMessage({
    type: 'load',
    modelPath: getModelPath(model.id),
    language,
    vadPath: getSttSideModelPath('vad'),
  })
  return true
}

/** Start a streaming session. Ensures worker is initialized and model is loaded. */
export function startStream(): void {
  streaming = true
  streamStarted = false
  if (restarting) return // the new worker's ready handler will begin the stream
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
  beginWhenReady()
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
  stopToken++
  const started = streamStarted
  streaming = false
  streamStarted = false
  pending.clear()
  settleReadiness(false)
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
      const buf = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) as ArrayBuffer
      worker.postMessage({ type: 'transcribe', id, buffer: buf }, [buf])
    }
  })
}

/** Flush recognizer — finalize the stream */
export function flushRecognizer(): void {
  finalizeStream()
}

/** Restart with potentially different model. Keeps the session (and its queued audio) alive. */
export function restartRecognizer(): void {
  const wasStreaming = streaming
  const token = stopToken

  if (!worker) {
    restarting = true
    if (!initRecognizer()) restarting = false
    return
  }
  restarting = true

  if (streaming) {
    // Flush the old model, but keep `streaming` true so audio arriving during the
    // switch is queued (and `streamStarted` false makes feedChunk queue it).
    worker.postMessage({ type: 'finalize' })
    streamStarted = false
  }
  worker.postMessage({ type: 'dispose' })

  setTimeout(() => {
    worker?.terminate()
    worker = null
    workerReady = false
    streamStarted = false
    readinessGeneration++
    settleReadiness(false)
    // A stop during the 200 ms teardown must not reload a model the DM ended.
    if (token !== stopToken) {
      restarting = false
      return
    }
    restarting = true
    if (!initRecognizer()) restarting = false
    if (wasStreaming) beginWhenReady()
  }, 200)
}

/** Free the worker */
export function freeRecognizer(): void {
  if (worker) {
    worker.postMessage({ type: 'dispose' })
    settleReadiness(false)
    // Don't call terminate immediately — let Metal clean up
    setTimeout(() => {
      worker?.terminate()
      worker = null
      workerReady = false
      streaming = false
    }, 500)
  }
}
