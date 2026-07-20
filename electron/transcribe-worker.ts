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
let lastCommitted = ''
let lastFlushed = '' // track what was already sent as flush
let silenceTimer: ReturnType<typeof setTimeout> | null = null

function sendMsg(msg: Record<string, unknown>) {
  parentPort!.postMessage(msg)
}

function clearSilenceTimer() {
  if (silenceTimer) {
    clearTimeout(silenceTimer)
    silenceTimer = null
  }
}

function scheduleSilenceFlush() {
  clearSilenceTimer()
  silenceTimer = setTimeout(() => {
    if (stream && lastCommitted && lastCommitted !== lastFlushed) {
      // Only send the new portion since last flush
      const delta = lastCommitted.slice(lastFlushed.length).trim()
      if (delta) {
        sendMsg({ type: 'flush', text: delta })
        lastFlushed = lastCommitted
      }
    }
  }, SILENCE_FLUSH_MS)
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
  if (!session) {
    sendMsg({ type: 'error', error: 'No model loaded' })
    return
  }
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
  sendMsg({ type: 'status', status: 'streaming' })
}

async function feedChunk(buffer: ArrayBuffer) {
  if (!stream) {
    sendMsg({ type: 'error', error: 'No active stream' })
    return
  }
  const samples = new Float32Array(buffer)
  await stream.feed(samples)
  const { committed, tentative } = stream.text

  // Only send update if text changed
  if (committed !== lastCommitted || tentative) {
    if (committed !== lastCommitted) {
      lastCommitted = committed
      scheduleSilenceFlush()
    }
    // Send the *delta* since last flush as interim — this is what the user sees streaming in
    const delta = committed.slice(lastFlushed.length)
    sendMsg({ type: 'text', committed: delta, tentative })
  }
}

async function finalizeStream() {
  if (!stream) {
    sendMsg({ type: 'error', error: 'No active stream' })
    return
  }
  clearSilenceTimer()
  await stream.finalize()
  const { committed } = stream.text
  // Only send the new portion since last flush
  const delta = committed.slice(lastFlushed.length).trim()
  if (delta) {
    sendMsg({ type: 'flush', text: delta })
  }
  stream.reset()
  stream = null
  lastCommitted = ''
  lastFlushed = ''
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
