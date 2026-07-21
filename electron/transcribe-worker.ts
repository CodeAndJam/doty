/**
 * transcribe-worker.ts — Worker thread for transcribe-cpp streaming/batch STT.
 * Single worker handles one model at a time. Supports hot-swap via 'load' message.
 *
 * Messages IN:
 *   { type: 'load', modelPath: string }       — load/swap GGUF model
 *   { type: 'stream-start' }                  — begin streaming session
 *   { type: 'feed', buffer: ArrayBuffer }     — feed PCM chunk to stream
 *   { type: 'finalize' }                      — finalize stream, get remaining text
 *   { type: 'transcribe', id: number, buffer: ArrayBuffer } — batch transcribe
 *   { type: 'dispose' }                       — clean up and allow termination
 *
 * Messages OUT:
 *   { type: 'ready', backends: [...] }        — model loaded, backends available
 *   { type: 'text', committed: string, tentative: string } — streaming text update
 *   { type: 'flush', text: string }           — finalized text after stream end
 *   { type: 'result', id: number, text: string } — batch transcription result
 *   { type: 'error', error: string }          — error message
 *   { type: 'status', status: string }        — status updates (loading, streaming, idle)
 */
import { parentPort } from 'node:worker_threads'

// ponytail: transcribe-cpp is ESM-only, use dynamic import from CJS worker
let TranscribeModel: any = null
let getAvailableBackends: any = null

let model: any = null
let session: any = null
let stream: any = null

// Silence timeout: if no new committed text for N ms, emit flush with delta
const SILENCE_FLUSH_MS = 2000
const PARAGRAPH_SILENCE_MS = 5000 // longer silence = new paragraph
let lastCommitted = ''
let lastFlushed = '' // track what was already sent as flush
let silenceTimer: ReturnType<typeof setTimeout> | null = null
let paragraphTimer: ReturnType<typeof setTimeout> | null = null
let streamStartTime = 0 // Date.now() when stream began
let _lastFeedTime = 0 // last time audio was fed (for paragraph detection)

function sendMsg(msg: Record<string, unknown>) {
  parentPort!.postMessage(msg)
}

function clearSilenceTimer() {
  if (silenceTimer) {
    clearTimeout(silenceTimer)
    silenceTimer = null
  }
  if (paragraphTimer) {
    clearTimeout(paragraphTimer)
    paragraphTimer = null
  }
}

function scheduleSilenceFlush() {
  clearSilenceTimer()
  silenceTimer = setTimeout(() => {
    if (stream && lastCommitted && lastCommitted !== lastFlushed) {
      const delta = lastCommitted.slice(lastFlushed.length).trim()
      if (delta) {
        const elapsedMs = Date.now() - streamStartTime
        sendMsg({ type: 'flush', text: delta, elapsedMs })
        lastFlushed = lastCommitted
      }
    }
  }, SILENCE_FLUSH_MS)
  // Schedule paragraph break on longer silence
  paragraphTimer = setTimeout(() => {
    sendMsg({ type: 'paragraph-break', elapsedMs: Date.now() - streamStartTime })
  }, PARAGRAPH_SILENCE_MS)
}

async function loadLib() {
  if (!TranscribeModel) {
    const lib = await import('transcribe-cpp')
    TranscribeModel = lib.TranscribeModel
    getAvailableBackends = lib.getAvailableBackends
  }
}

async function loadModel(modelPath: string) {
  await loadLib()

  // Dispose previous model if hot-swapping
  if (stream) {
    try {
      stream.reset()
    } catch {
      /* ignore */
    }
    stream = null
  }
  if (session) {
    try {
      session.dispose()
    } catch {
      /* ignore */
    }
    session = null
  }
  if (model) {
    try {
      model.dispose()
    } catch {
      /* ignore */
    }
    model = null
  }

  sendMsg({ type: 'status', status: 'loading' })
  model = await TranscribeModel.load(modelPath, { backend: 'auto' })
  session = model.createSession()

  const backends = getAvailableBackends()
  sendMsg({ type: 'ready', backends })
  sendMsg({ type: 'status', status: 'idle' })
}

async function startStream() {
  if (!session) return // model not loaded yet — caller will retry
  // Reset stream if one exists
  if (stream) {
    try {
      stream.reset()
    } catch {
      /* ignore */
    }
  }
  stream = await session.stream({ commitPolicy: 'stable_prefix' })
  lastCommitted = ''
  lastFlushed = ''
  streamStartTime = Date.now()
  _lastFeedTime = Date.now()
  sendMsg({ type: 'status', status: 'streaming' })
}

async function feedChunk(buffer: ArrayBuffer) {
  if (!stream) return // silently drop — stream not active (during model swap)
  const samples = new Float32Array(buffer)
  await stream.feed(samples)
  _lastFeedTime = Date.now()
  if (!stream) return // stream may have been reset during async feed
  const { committed, tentative } = stream.text

  if (committed !== lastCommitted || tentative) {
    if (committed !== lastCommitted) {
      lastCommitted = committed
      scheduleSilenceFlush()
    }
    const delta = committed.slice(lastFlushed.length)
    const elapsedMs = Date.now() - streamStartTime
    sendMsg({ type: 'text', committed: delta, tentative, elapsedMs })
  }
}

async function finalizeStream() {
  if (!stream) return // already finalized or never started
  clearSilenceTimer()
  await stream.finalize()
  const { committed } = stream.text
  const delta = committed.slice(lastFlushed.length).trim()
  if (delta) {
    const elapsedMs = Date.now() - streamStartTime
    sendMsg({ type: 'flush', text: delta, elapsedMs })
  }
  stream.reset()
  stream = null
  lastCommitted = ''
  lastFlushed = ''
  streamStartTime = 0
  sendMsg({ type: 'status', status: 'idle' })
}

async function batchTranscribe(id: number, buffer: ArrayBuffer) {
  if (!model) {
    sendMsg({ type: 'result', id, text: '', error: 'No model loaded' })
    return
  }
  const samples = new Float32Array(buffer)
  const result = await model.transcribe(samples)
  sendMsg({ type: 'result', id, text: result.text })
}

function dispose() {
  clearSilenceTimer()
  if (stream) {
    try {
      stream.reset()
    } catch {
      /* ignore */
    }
    stream = null
  }
  if (session) {
    try {
      session.dispose()
    } catch {
      /* ignore */
    }
    session = null
  }
  if (model) {
    try {
      model.dispose()
    } catch {
      /* ignore */
    }
    model = null
  }
  sendMsg({ type: 'status', status: 'disposed' })
}

parentPort!.on('message', async (msg: any) => {
  try {
    switch (msg.type) {
      case 'load':
        await loadModel(msg.modelPath)
        break
      case 'stream-start':
        await startStream()
        break
      case 'feed':
        await feedChunk(msg.buffer)
        break
      case 'finalize':
        await finalizeStream()
        break
      case 'transcribe':
        await batchTranscribe(msg.id, msg.buffer)
        break
      case 'dispose':
        dispose()
        break
      default:
        sendMsg({ type: 'error', error: `Unknown message type: ${msg.type}` })
    }
  } catch (e: any) {
    sendMsg({ type: 'error', error: e?.message ?? String(e) })
  }
})
