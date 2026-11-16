/**
 * transcribe-worker.ts — Worker thread for transcribe-cpp STT.
 *
 * Two live modes, chosen from the loaded model's capabilities:
 *   stream  — the engine decodes as audio arrives (Nemotron, Voxtral, Parakeet Unified)
 *   chunked — batch-only models (Parakeet Ultra/TDT) decode ~10s chunks as they fill
 *
 * When a VAD model is available the audio is gated by speech probability instead
 * of level, so a loud music bed never reaches the decoder. Without it the
 * level-based path runs unchanged.
 *
 * Text must reach the transcript while the session is still running: some
 * streaming models freeze `committed` for a whole minute, so finalized text is
 * derived from the full hypothesis up to the last sentence boundary.
 *
 * Messages IN:
 *   { type: 'load', modelPath, language?, vadPath? } — load/swap GGUF model
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
 *   { type: 'notice', message }               — degraded feature, session continues
 *   { type: 'error', error }                  — error message
 *   { type: 'status', status }                — loading | streaming | idle | disposed
 */
import { parentPort } from 'node:worker_threads'
import { resolveLanguage } from './stt-language'
import { plausibleText } from './stt-quality/script'
import { ChunkBuffer, hasSpeech, LiveWriter, rms } from './stt-quality/text-flow'
import { SpeechGate } from './stt-quality/vad-gate'

// ponytail: transcribe-cpp is ESM-only, use dynamic import from CJS worker
let TranscribeModel: any = null
let getAvailableBackends: any = null

let model: any = null
let session: any = null
let stream: any = null
let supportsStreaming = false
let language: string | undefined

/** Optional VAD model (role "vad"); null when not downloaded or not loadable. */
let vadModel: any = null
let vadSession: any = null
/** Speech gating over the live audio; null keeps the level-based fallback. */
let gate: SpeechGate | null = null

const SILENCE_FLUSH_MS = 1500
const PARAGRAPH_SILENCE_MS = 5000
const CHUNK_MAX_MS = 10_000
const SILENCE_RMS = 0.003
/** Gated speech is released in 160 ms pieces: small enough to feel live. */
const LIVE_EMIT_SAMPLES = 16000 * 0.16
/**
 * A batch decoder must not see each VAD phrase alone. Short isolated segments
 * are what turn mumbles into invented words ("Resurrê? O presužma", "Gareth");
 * accumulating at least this much speech before a decode keeps the context.
 */
const BATCH_MIN_SAMPLES = 16000 * 2
/**
 * How long a pause must last before a batch model decodes what it has. Shorter
 * and a phrase is decoded alone, which is where invented words come from;
 * longer and the transcript lags the table.
 */
const BATCH_FLUSH_MS = 3_000

const writer = new LiveWriter()
const chunks = new ChunkBuffer({
  maxSamples: (CHUNK_MAX_MS / 1000) * 16000,
  minSamples: 16000 * 2,
  silenceRms: SILENCE_RMS,
  silenceSamples: 16000 * 1.5,
})
let silenceTimer: ReturnType<typeof setTimeout> | null = null
/** Batch-only: decode pending gated speech after the speaker has paused. */
let gatedFlushTimer: ReturnType<typeof setTimeout> | null = null
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
  if (gatedFlushTimer) clearTimeout(gatedFlushTimer)
  silenceTimer = null
  paragraphTimer = null
  gatedFlushTimer = null
}

/** Batch models: let phrases merge, but do not wait forever for more speech. */
function scheduleGatedFlush(): void {
  if (gatedFlushTimer) clearTimeout(gatedFlushTimer)
  gatedFlushTimer = setTimeout(() => {
    gatedFlushTimer = null
    if (!supportsStreaming && chunks.pendingSamples >= BATCH_MIN_SAMPLES) {
      void decodeChunk().catch(() => {})
    }
  }, BATCH_FLUSH_MS)
}

function elapsedMs(): number {
  return streamStartTime ? Date.now() - streamStartTime : 0
}

function flush(text: string) {
  const delta = text.trim()
  if (!delta) return
  // Noise decodes into fluent text in whatever language fits it. With a language
  // pinned, text in another script cannot belong to this session, and a short
  // segment with letters outside that language's alphabet is a mumble filled in.
  if (!plausibleText(delta, language)) return
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
  releaseSupportModels()
  writer.reset(0)
  chunks.reset()
  lastHypothesis = ''
  clearTimers()
}

/** Support models are disposable independently of the ASR model. */
function releaseSupportModels() {
  try {
    vadSession?.dispose()
  } catch {
    /* ignore */
  }
  try {
    vadModel?.dispose()
  } catch {
    /* ignore */
  }
  vadSession = null
  vadModel = null
  gate = null
}

/**
 * Load the VAD model. A missing file, a failed load or a file that does not
 * serve the role all mean the same thing: keep the fallback path, never block
 * transcription.
 */
async function loadVadModel(path: string | null | undefined): Promise<any> {
  if (!path) return null
  try {
    const m = await TranscribeModel.load(path)
    if (!m.roles.includes('vad')) {
      sendMsg({ type: 'notice', message: 'VAD model does not serve the "vad" role; using the fallback' })
      m.dispose()
      return null
    }
    return m
  } catch (e: any) {
    sendMsg({ type: 'notice', message: `VAD model failed to load; using the fallback (${e?.message ?? e})` })
    return null
  }
}

/** Drop VAD mid-session: the audio keeps flowing, only the gating is lost. */
function giveUpVad(error: any) {
  sendMsg({ type: 'notice', message: `VAD failed; falling back to level gating (${error?.message ?? error})` })
  releaseSupportModels()
}

interface LoadRequest {
  modelPath: string
  /** The persisted `sttLanguage` setting: `auto` or a locale. */
  language?: string
  vadPath?: string | null
  backend?: 'auto' | 'cpu'
}

async function loadModel(req: LoadRequest) {
  const { modelPath, language: requestedLanguage, vadPath, backend = 'auto' } = req
  await loadLib()
  releaseAll()

  sendMsg({ type: 'status', status: 'loading' })
  try {
    model = await TranscribeModel.load(modelPath, { backend })
  } catch (e) {
    // A dead GPU must degrade the session, not end it: retry once on the CPU,
    // which is the same recovery Handy's own supervisor performs.
    if (backend === 'cpu') throw e
    sendMsg({ type: 'status', status: 'loading' })
    sendMsg({ type: 'notice', message: 'GPU failed to load; retrying on the CPU' })
    return loadModel({ ...req, backend: 'cpu' })
  }
  session = model.createSession()
  const caps = model.capabilities
  supportsStreaming = Boolean(caps?.supportsStreaming)
  // Focus on one language instead of letting the model detect it per chunk.
  // A wrong code makes the engine throw, so resolve against its own list.
  const supported = (caps?.languages ?? []) as string[]
  language = resolveLanguage(requestedLanguage, supported)

  vadModel = await loadVadModel(vadPath)
  if (vadModel) vadSession = vadModel.createVadSession()

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

  // With a VAD model the decoder only ever sees speech, released in 160 ms
  // pieces. Batch models then accumulate those pieces into a ChunkBuffer: a
  // phrase decoded alone is where invented words come from.
  gate = vadSession
    ? new SpeechGate({
        emitSamples: LIVE_EMIT_SAMPLES,
        // Natural sentence pauses in Portuguese run 300-600 ms. Closing at 300
        // split "parece-vos bem? / parece-vos mal?" into two decodes, each of
        // which the model completed with invented words.
        minSilenceMs: 800,
      })
    : null
  if (vadSession) {
    try {
      await vadSession.streamReset()
    } catch {
      /* a stale stream is replaced by the next feed */
    }
  }
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
  await decodeBatch(pcm)
}

/** Batch decode one piece of audio. */
async function decodeBatch(pcm: Float32Array) {
  if (!session || pcm.length < 1600) return
  const result = await session.run(pcm, language ? { language } : undefined)
  const text: string = (result?.text ?? '').trim()
  if (!text) return
  sendMsg({ type: 'text', committed: text, tentative: '' })
  flush(text)
}

/** VAD path: only the audio the gate calls speech reaches the decoder. */
async function decodeGated() {
  if (!gate) return
  const { chunks: speech, closed } = gate.drain()
  for (const pcm of speech) {
    if (supportsStreaming) {
      await feedStream(pcm)
    } else {
      // Batch: merge gated pieces into a window. Decoding each VAD phrase alone
      // is what produced "Punks", "Got it" and "Gareth" on a real session.
      if (gatedFlushTimer) {
        clearTimeout(gatedFlushTimer)
        gatedFlushTimer = null
      }
      chunks.push(pcm)
      if (chunks.ready()) await decodeChunk()
    }
  }
  if (!closed) return
  if (stream) {
    // The speaker stopped: commit the hypothesis now instead of waiting for the
    // 1.5 s timer, which may never fire because no more audio is being fed.
    flush(writer.onSilence(stream.text.full, elapsedMs()))
  } else {
    // Do not decode yet: a natural pause is not the end of the thought.
    scheduleGatedFlush()
  }
}

/** No VAD model: the level gate and the chunk buffer, exactly as before. */
async function feedAll(samples: Float32Array) {
  if (supportsStreaming) {
    await feedStream(samples)
    return
  }
  chunks.push(samples)
  while (chunks.ready()) await decodeChunk()
  if (!chunks.ready() && rms(samples) >= SILENCE_RMS) armSilenceTimers()
}

async function feedChunk(buffer: ArrayBuffer) {
  const samples = new Float32Array(buffer)
  if (vadSession && gate) {
    let probs: number[] = []
    try {
      probs = (await vadSession.streamFeed(samples)).probs
    } catch (e: any) {
      // Gating is an enhancement, never a requirement: run this chunk through
      // the fallback path so the session keeps working.
      giveUpVad(e)
      await feedAll(samples)
      return
    }
    gate.push(samples, probs)
    await decodeGated()
    return
  }
  await feedAll(samples)
}

/** Score the tail the VAD still holds and decode whatever the gate releases. */
async function flushGate() {
  if (!gate || !vadSession) return
  try {
    const tail = await vadSession.streamFlush()
    gate.push(new Float32Array(0), tail.probs)
  } catch {
    /* the last <32 ms of audio is lost, not the session */
  }
  const { chunks: speech } = gate.flush()
  for (const pcm of speech) {
    if (supportsStreaming) await feedStream(pcm)
    else chunks.push(pcm)
  }
  if (!supportsStreaming && chunks.pendingSamples > 0) await decodeChunk()
}

async function finalizeSession() {
  clearTimers()
  await flushGate()
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
  gate?.reset()
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
          await loadModel(msg)
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
