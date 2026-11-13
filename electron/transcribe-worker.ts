/**
 * transcribe-worker.ts — Worker thread for transcribe-cpp STT.
 *
 * Two live modes, chosen from the loaded model's capabilities:
 *   stream  — the engine decodes as audio arrives (Nemotron, Voxtral, Parakeet Unified)
 *   chunked — batch-only models (Parakeet Ultra/TDT) decode ~10s chunks as they fill
 *
 * Text must reach the transcript while the session is still running: some
 * streaming models freeze `committed` for a whole minute, so finalized text is
 * derived from the full hypothesis up to the last sentence boundary.
 *
 * Messages IN:
 *   { type: 'load', modelPath, language? }    — load/swap GGUF model
 *   { type: 'stream-start' }                  — begin a live session
 *   { type: 'feed', buffer: ArrayBuffer }     — feed PCM chunk
 *   { type: 'finalize' }                      — flush remaining audio and text
 *   { type: 'transcribe', id, buffer }        — one-shot batch transcription
 *   { type: 'dispose' }                       — clean up and allow termination
 *
 * Messages OUT:
 *   { type: 'ready', backends, streaming, languages, language } — model loaded
 *   { type: 'text', committed, tentative }    — live hypothesis for the UI
 *   { type: 'flush', text, elapsedMs }        — finalized text to append
 *   { type: 'result', id, text }              — batch transcription result
 *   { type: 'error', error }                  — error message
 *   { type: 'status', status }                — loading | streaming | idle | disposed
 */
import { parentPort } from 'node:worker_threads'
import { resolveLanguage } from './stt-language'
import { scriptMatchesLanguage } from './stt-quality/script'
import { ChunkBuffer, hasSpeech, LiveWriter, rms } from './stt-quality/text-flow'

// ponytail: transcribe-cpp is ESM-only, use dynamic import from CJS worker
let TranscribeModel: any = null
let getAvailableBackends: any = null

let model: any = null
let session: any = null
let stream: any = null
let supportsStreaming = false
let language: string | undefined

const SILENCE_FLUSH_MS = 1500
const PARAGRAPH_SILENCE_MS = 5000
const CHUNK_MAX_MS = 10_000
const SILENCE_RMS = 0.003

const writer = new LiveWriter()
const chunks = new ChunkBuffer({
  maxSamples: (CHUNK_MAX_MS / 1000) * 16000,
  minSamples: 16000 * 2,
  silenceRms: SILENCE_RMS,
  silenceSamples: 16000 * 1.5,
})
let silenceTimer: ReturnType<typeof setTimeout> | null = null
let paragraphTimer: ReturnType<typeof setTimeout> | null = null
let streamStartTime = 0
let lastHypothesis = ''

// Messages are handled strictly in order: feed and finalize used to interleave,
// which dropped audio and could finish a session twice.
let pipeline: Promise<void> = Promise.resolve()

function sendMsg(msg: Record<string, unknown>) {
  parentPort!.postMessage(msg)
}

function clearTimers() {
  if (silenceTimer) clearTimeout(silenceTimer)
  if (paragraphTimer) clearTimeout(paragraphTimer)
  silenceTimer = null
  paragraphTimer = null
}

function elapsedMs(): number {
  return streamStartTime ? Date.now() - streamStartTime : 0
}

function flush(text: string) {
  const delta = text.trim()
  if (!delta) return
  // Noise decodes into fluent text in whatever language fits it. With a language
  // pinned, text in another script cannot belong to this session.
  if (!scriptMatchesLanguage(delta, language)) return
  sendMsg({ type: 'flush', text: delta, elapsedMs: elapsedMs() })
}

function armSilenceTimers() {
  clearTimers()
  silenceTimer = setTimeout(() => {
    // Runs on the same queue as feeds, so a timer can never start a model call
    // while the pipeline already has one in flight.
    pipeline = pipeline.then(async () => {
      try {
        // Speaker paused: commit what the model has (minus its last word).
        if (stream) flush(writer.onSilence(stream.text.full, elapsedMs()))
        else if (chunks.pendingSamples > 0) await decodeChunk()
      } catch (e: any) {
        sendMsg({ type: 'error', error: e?.message ?? String(e) })
      }
    })
  }, SILENCE_FLUSH_MS)
  paragraphTimer = setTimeout(() => {
    sendMsg({ type: 'paragraph-break', elapsedMs: elapsedMs() })
  }, PARAGRAPH_SILENCE_MS)
}

async function loadLib() {
  if (!TranscribeModel) {
    const lib = await import('transcribe-cpp')
    TranscribeModel = lib.TranscribeModel
    getAvailableBackends = lib.getAvailableBackends
  }
}

function releaseAll() {
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
  writer.reset(0)
  chunks.reset()
  lastHypothesis = ''
  clearTimers()
}

async function loadModel(modelPath: string, requestedLanguage?: string) {
  await loadLib()
  releaseAll()

  sendMsg({ type: 'status', status: 'loading' })
  model = await TranscribeModel.load(modelPath, { backend: 'auto' })
  session = model.createSession()
  const caps = model.capabilities
  supportsStreaming = Boolean(caps?.supportsStreaming)
  // Focus on one language instead of letting the model detect it per chunk.
  // A wrong code makes the engine throw, so resolve against its own list.
  const supported = (caps?.languages ?? []) as string[]
  language = resolveLanguage(requestedLanguage, supported)

  const backends = getAvailableBackends()
  sendMsg({ type: 'ready', backends, streaming: supportsStreaming, languages: supported, language: language ?? 'auto' })
  sendMsg({ type: 'status', status: 'idle' })
}

async function startSession() {
  chunks.reset()
  lastHypothesis = ''
  streamStartTime = Date.now()
  writer.reset(0)
  clearTimers()

  if (supportsStreaming) {
    if (!session) return
    stream = await session.stream({
      commitPolicy: 'stable_prefix',
      ...(language ? { language } : {}),
    })
  }
  sendMsg({ type: 'status', status: supportsStreaming ? 'streaming' : 'streaming-chunked' })
}

/** Streaming: surface the live hypothesis and commit complete sentences. */
async function feedStream(samples: Float32Array) {
  if (!stream) return
  await stream.feed(samples)
  if (!stream) return
  const full: string = stream.text.full ?? ''
  if (full !== lastHypothesis) {
    lastHypothesis = full
    armSilenceTimers()
  }
  const delta = writer.onHypothesis(full, elapsedMs())
  const settled = writer.settled
  // Only text past the settled part is still being revised, and only that tail
  // is shown live — flushed text is already in the transcript.
  const tentative = full.startsWith(settled) ? full.slice(settled.length) : ''
  sendMsg({ type: 'text', committed: '', tentative })
  flush(delta)
}

/** Batch-only models: decode each filled chunk while the session runs. */
async function decodeChunk() {
  if (!session || chunks.pendingSamples < 1600) return // <100ms: nothing to decode
  const pcm = chunks.take()
  // Nothing above the noise floor: decoding it only invents a sentence.
  if (!hasSpeech(pcm)) return
  const result = await session.run(pcm, language ? { language } : undefined)
  const text: string = (result?.text ?? '').trim()
  if (!text) return
  sendMsg({ type: 'text', committed: text, tentative: '' })
  flush(text)
}

async function feedChunk(buffer: ArrayBuffer) {
  const samples = new Float32Array(buffer)
  if (supportsStreaming) {
    await feedStream(samples)
    return
  }
  chunks.push(samples)
  while (chunks.ready()) await decodeChunk()
  if (!chunks.ready() && rms(samples) >= SILENCE_RMS) armSilenceTimers()
}

async function finalizeSession() {
  clearTimers()
  if (supportsStreaming && stream) {
    await stream.finalize()
    const full: string = stream.text.full ?? ''
    flush(writer.onFinal(full))
    try {
      stream.reset()
    } catch {
      /* ignore */
    }
    stream = null
  } else if (!supportsStreaming) {
    // Everything still buffered must be transcribed before the session closes.
    while (chunks.pendingSamples >= 1600) await decodeChunk()
  }
  writer.reset()
  chunks.reset()
  lastHypothesis = ''
  streamStartTime = 0
  sendMsg({ type: 'status', status: 'idle' })
}

async function batchTranscribe(id: number, buffer: ArrayBuffer) {
  if (!model || !session) {
    sendMsg({ type: 'result', id, text: '', error: 'No model loaded' })
    return
  }
  const samples = new Float32Array(buffer)
  const result = await session.run(samples, language ? { language } : undefined)
  sendMsg({ type: 'result', id, text: result.text })
}

parentPort!.on('message', (msg: any) => {
  pipeline = pipeline.then(async () => {
    try {
      switch (msg.type) {
        case 'load':
          await loadModel(msg.modelPath, msg.language)
          break
        case 'stream-start':
          await startSession()
          break
        case 'feed':
          await feedChunk(msg.buffer)
          break
        case 'finalize':
          await finalizeSession()
          break
        case 'transcribe':
          await batchTranscribe(msg.id, msg.buffer)
          break
        case 'dispose':
          releaseAll()
          sendMsg({ type: 'status', status: 'disposed' })
          break
        default:
          sendMsg({ type: 'error', error: `Unknown message type: ${msg.type}` })
      }
    } catch (e: any) {
      sendMsg({ type: 'error', error: e?.message ?? String(e) })
    }
  })
})
