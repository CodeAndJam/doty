import fs from 'node:fs'
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sherpa = require('sherpa-onnx-node')

const MODEL_DIR: string = workerData.modelDir
const VAD_MODEL_PATH: string = workerData.vadModelPath
const HOTWORDS_FILE: string | null = workerData.hotwordsFile || null
const DENOISER_MODEL_PATH: string | null = workerData.denoiserModelPath || null
const STT_MODEL: string = workerData.sttModel || 'parakeet'

const SAMPLE_RATE = 16000

// ── Recognizer initialization ─────────────────────────────────────────────────
// Supports Parakeet TDT (default) and Whisper (medium, large-v3).

// Determine decoding strategy: use beam search when hotwords are available
const hasHotwords =
  HOTWORDS_FILE && fs.existsSync(HOTWORDS_FILE) && fs.readFileSync(HOTWORDS_FILE, 'utf-8').trim().length > 0

function createRecognizer() {
  if (STT_MODEL.startsWith('whisper')) {
    // Whisper models use encoder/decoder architecture with language parameter
    const prefix = STT_MODEL === 'whisper-medium' ? 'medium' : 'large-v3'
    // Whisper large-v3 uses 128-dim features; medium and smaller use 80
    const featureDim = STT_MODEL === 'whisper-large-v3' ? 128 : 80

    console.log(`[asr-worker] Initializing Whisper (${prefix}), featureDim=${featureDim}`)
    return new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim },
      modelConfig: {
        whisper: {
          encoder: join(MODEL_DIR, `${prefix}-encoder.int8.onnx`),
          decoder: join(MODEL_DIR, `${prefix}-decoder.int8.onnx`),
          language: '', // auto-detect language
          task: 'transcribe',
          tailPaddings: -1,
        },
        tokens: join(MODEL_DIR, `${prefix}-tokens.txt`),
        numThreads: 4,
        debug: 0,
      },
      decodingMethod: 'greedy_search',
    })
  }

  // Default: Parakeet TDT v3
  console.log('[asr-worker] Initializing Parakeet TDT v3')
  return new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(MODEL_DIR, 'encoder.int8.onnx'),
        decoder: join(MODEL_DIR, 'decoder.int8.onnx'),
        joiner: join(MODEL_DIR, 'joiner.int8.onnx'),
      },
      tokens: join(MODEL_DIR, 'tokens.txt'),
      numThreads: 4,
      debug: 0,
      modelType: 'nemo_transducer',
    },
    decodingMethod: hasHotwords ? 'modified_beam_search' : 'greedy_search',
    maxActivePaths: hasHotwords ? 4 : 1,
    hotwordsFile: hasHotwords ? HOTWORDS_FILE : '',
    hotwordsScore: hasHotwords ? 2.0 : 0,
    blankPenalty: 0.5,
  })
}

const recognizer = createRecognizer()

// ── Silero VAD ────────────────────────────────────────────────────────────────
// Tuned for multilingual accuracy: longer segments give the model more audio
// context for language identification, reducing en/pt confusion.
//   - minSilenceDuration 0.5s: merges nearby speech into longer segments
//   - minSpeechDuration 0.25s: drops very short bursts that confuse LID
//   - threshold 0.3: catches quieter speech
//   - maxSpeechDuration 15s: long DM monologues
let vad: InstanceType<typeof sherpa.Vad> | null = null
if (fs.existsSync(VAD_MODEL_PATH)) {
  try {
    vad = new sherpa.Vad(
      {
        sileroVad: {
          model: VAD_MODEL_PATH,
          threshold: 0.3,
          minSilenceDuration: 0.5,
          minSpeechDuration: 0.25,
          windowSize: 512,
          maxSpeechDuration: 15,
        },
        sampleRate: SAMPLE_RATE,
        numThreads: 1,
        debug: 0,
      },
      30,
    )
    console.log('[asr-worker] Silero VAD initialized (threshold=0.3, minSilence=0.5, minSpeech=0.25, maxSpeech=15s)')
  } catch (e) {
    console.error('[asr-worker] VAD init failed, falling back to raw chunks:', e)
    vad = null
  }
}

// ── GTCRN Speech Denoiser ─────────────────────────────────────────────────────
let denoiser: unknown = null
if (DENOISER_MODEL_PATH && fs.existsSync(DENOISER_MODEL_PATH)) {
  try {
    denoiser = new sherpa.OfflineSpeechDenoiser({
      model: {
        gtcrn: { model: DENOISER_MODEL_PATH },
        numThreads: 1,
        debug: 0,
      },
      sampleRate: SAMPLE_RATE,
    })
    console.log('[asr-worker] GTCRN speech denoiser initialized')
  } catch (e) {
    console.error('[asr-worker] Denoiser init failed (non-fatal):', e)
    denoiser = null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function denoiseSamples(samples: Float32Array): Float32Array {
  if (!denoiser) return samples
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (denoiser as any).run({ samples, sampleRate: SAMPLE_RATE, enableExternalBuffer: false })
    return result.samples ?? samples
  } catch {
    return samples
  }
}

function transcribeSegment(samples: Float32Array, sampleRate: number): string {
  const cleaned = denoiseSamples(samples)
  const stream = recognizer.createStream()
  stream.acceptWaveform({ samples: cleaned, sampleRate })
  recognizer.decode(stream)
  const result = recognizer.getResult(stream)
  return (result.text as string).trim()
}

// ── Confidence filtering ──────────────────────────────────────────────────────
// Filters out low-quality transcriptions: very short text, single repeated
// characters, or segments too brief to contain meaningful speech.

/** Minimum audio duration in seconds for a segment to be worth transcribing */
const MIN_SEGMENT_DURATION_S = 0.3

/** Returns true if the transcription looks like garbage / noise artifacts */
function isGarbageText(text: string): boolean {
  if (text.length <= 2) return true
  // Single repeated word/char like "the the" or "a a a"
  if (/^(\S+)(\s+\1)+$/i.test(text)) return true
  // Only whitespace and single characters like "I" or "a" with spaces
  if (/^(\s*\S\s*){1,2}$/.test(text)) return true
  return false
}

// ── VAD flush on silence ──────────────────────────────────────────────────────
// When no audio arrives for FLUSH_TIMEOUT_MS, flush the VAD to push any
// pending partial speech segment through for transcription.
const FLUSH_TIMEOUT_MS = 2000
let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    if (!vad) return
    try {
      vad.flush()
      const texts: string[] = []
      while (!vad.isEmpty()) {
        const segment = vad.front(false)
        vad.pop()
        const durationS = segment.samples.length / SAMPLE_RATE
        if (durationS < MIN_SEGMENT_DURATION_S) continue
        const text = transcribeSegment(segment.samples, SAMPLE_RATE)
        if (text && !isGarbageText(text)) texts.push(text)
      }
      if (texts.length > 0) {
        // Use a separate message type so asr.ts can forward directly to renderer
        // (the original request's promise was already resolved)
        parentPort!.postMessage({ type: 'flush', text: texts.join(' ') })
      }
    } catch (e) {
      console.error('[asr-worker] flush error:', e)
    }
  }, FLUSH_TIMEOUT_MS)
}

// ── Message handler ───────────────────────────────────────────────────────────

parentPort!.on('message', ({ id, buffer, sampleRate }: { id: number; buffer: ArrayBuffer; sampleRate: number }) => {
  try {
    const samples = new Float32Array(buffer)

    if (vad) {
      // Feed audio through VAD — it accumulates internally across calls,
      // so speech that spans chunk boundaries is handled correctly.
      vad.acceptWaveform(samples)
      const texts: string[] = []

      while (!vad.isEmpty()) {
        const segment = vad.front(false)
        vad.pop()
        // Skip segments too short to contain meaningful speech
        const durationS = segment.samples.length / SAMPLE_RATE
        if (durationS < MIN_SEGMENT_DURATION_S) continue
        const text = transcribeSegment(segment.samples, sampleRate)
        if (text && !isGarbageText(text)) texts.push(text)
      }

      // Schedule a flush in case this is the last chunk for a while
      scheduleFlush()

      parentPort!.postMessage({ id, text: texts.join(' ') })
    } else {
      // Fallback: denoise + transcribe the raw chunk directly
      const text = transcribeSegment(samples, sampleRate)
      const filtered = text && !isGarbageText(text) ? text : ''
      parentPort!.postMessage({ id, text: filtered })
    }
  } catch (e) {
    parentPort!.postMessage({ id, error: String(e) })
  }
})
