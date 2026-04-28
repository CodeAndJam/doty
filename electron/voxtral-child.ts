/**
 * voxtral-child.ts
 * Runs as an Electron utilityProcess child with its own V8 heap.
 *
 * Best practices from the model card:
 * - Temperature = 0.0
 * - Streaming architecture: feed audio continuously
 * - 480ms delay (sweet spot of performance and low latency)
 * - One text token = 80ms of audio
 *
 * We accumulate audio and transcribe in segments (VAD-like),
 * since the app sends 1-second chunks from the microphone.
 */
import { join } from 'node:path'

const homePath = process.env.HOME ?? process.env.USERPROFILE ?? ''
const MODEL_ID = 'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processor: any = null

const SAMPLE_RATE = 16000
const MIN_SECONDS = 5 // minimum audio to attempt transcription (model needs context for language detection)
const MAX_SECONDS = 30 // flush after this much audio
const SILENCE_THRESHOLD = 0.02 // RMS below this = silence (tuned for real mic)
const SPEECH_THRESHOLD = 0.03 // RMS above this = speech detected
const SILENCE_CHUNKS = 3 // 3 consecutive silent 1s chunks to trigger flush

let audioBuffer = new Float32Array(0)
let silenceCount = 0
let hasSpeech = false // track if we've seen actual speech in this segment

async function loadModel() {
  if (model && processor) return
  console.log('[voxtral-child] Loading Voxtral model...')
  process.parentPort.postMessage({ type: 'status', status: 'loading' })

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { VoxtralRealtimeForConditionalGeneration, VoxtralRealtimeProcessor, env } = require('@huggingface/transformers')
  env.cacheDir = join(homePath, '.doty', 'hf-cache')
  env.allowRemoteModels = true

  processor = await VoxtralRealtimeProcessor.from_pretrained(MODEL_ID)
  model = await VoxtralRealtimeForConditionalGeneration.from_pretrained(MODEL_ID, {
    dtype: { audio_encoder: 'q4f16', embed_tokens: 'q4f16', decoder_model_merged: 'q4f16' },
    device: 'cpu',
  })

  console.log('[voxtral-child] Model ready')
  process.parentPort.postMessage({ type: 'status', status: 'ready' })
}

function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

async function transcribeBuffer(): Promise<string> {
  if (audioBuffer.length < SAMPLE_RATE * MIN_SECONDS) return ''
  await loadModel()

  const samples = audioBuffer
  audioBuffer = new Float32Array(0)

  const hop = processor.feature_extractor.config.hop_length
  const nfft = processor.feature_extractor.config.n_fft
  const numSamplesFirst = processor.num_samples_first_audio_chunk

  let audio = samples
  if (audio.length < numSamplesFirst + nfft + hop * 8) {
    const padded = new Float32Array(numSamplesFirst + nfft + hop * 8)
    padded.set(audio)
    audio = padded
  }

  const firstChunk = await processor(audio.subarray(0, numSamplesFirst), {
    is_streaming: true,
    is_first_audio_chunk: true,
  })

  const numMelFirst = processor.num_mel_frames_first_audio_chunk
  const winHalf = Math.floor(nfft / 2)
  const startIdx = numMelFirst * hop - winHalf

  let secondAudio = audio.slice(startIdx)
  const rawMel = Math.floor((secondAudio.length - nfft) / hop)
  const rem = rawMel % 8
  if (rem !== 0) {
    const padded = new Float32Array(secondAudio.length + (8 - rem) * hop)
    padded.set(secondAudio)
    secondAudio = padded
  }

  async function* featureGen() {
    yield firstChunk.input_features
    const chunk = await processor(secondAudio, { is_streaming: true, is_first_audio_chunk: false })
    yield chunk.input_features
  }

  // Best practice: temperature = 0.0 for deterministic transcription
  // max_new_tokens: 1 token = 80ms, so for N seconds: N * 1000 / 80
  const maxTokens = Math.ceil((samples.length / SAMPLE_RATE) * 1000 / 80) + 10
  const outputs = await model.generate({
    input_ids: firstChunk.input_ids,
    input_features: featureGen(),
    max_new_tokens: maxTokens,
    temperature: 0.0,
    do_sample: false,
  })

  const decoded = processor.tokenizer.batch_decode(outputs, { skip_special_tokens: true })
  return (decoded[0] ?? '').trim()
}

process.parentPort.on('message', async (e: Electron.MessageEvent) => {
  const { id, buffer } = e.data as { id: number; buffer: ArrayBuffer }

  const samples = new Float32Array(buffer)

  // Append to buffer
  const merged = new Float32Array(audioBuffer.length + samples.length)
  merged.set(audioBuffer)
  merged.set(samples, audioBuffer.length)
  audioBuffer = merged

  // Detect silence for speech boundary detection
  const chunkRms = rms(samples)
  if (chunkRms < SILENCE_THRESHOLD) {
    silenceCount++
  } else {
    silenceCount = 0
    if (chunkRms >= SPEECH_THRESHOLD) hasSpeech = true
  }

  const durationS = audioBuffer.length / SAMPLE_RATE
  const shouldFlush = hasSpeech && ((silenceCount >= SILENCE_CHUNKS && durationS >= MIN_SECONDS) || durationS >= MAX_SECONDS)

  // Drop buffer if no speech detected and too much silence accumulated
  if (!hasSpeech && silenceCount >= SILENCE_CHUNKS && durationS >= MIN_SECONDS) {
    audioBuffer = new Float32Array(0)
    silenceCount = 0
  }

  if (shouldFlush) {
    silenceCount = 0
    hasSpeech = false
    try {
      const text = await transcribeBuffer()
      if (text) {
        console.log(`[voxtral-child] transcribed: "${text.slice(0, 100)}"`)
        process.parentPort.postMessage({ type: 'flush', text })
      }
    } catch (err) {
      console.error('[voxtral-child] transcribe error:', err)
    }
  }

  // Respond immediately to keep pending map clean
  process.parentPort.postMessage({ id, text: '' })
})
