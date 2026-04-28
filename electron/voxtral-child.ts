/**
 * voxtral-child.ts
 * Runs as an Electron utilityProcess with persistent streaming generate() session.
 *
 * Architecture (matching the WebGPU demo):
 * - One long-running generate() call per recording session
 * - Audio chunks fed via async generator that blocks until data arrives
 * - Tokens emitted incrementally via a streamer callback
 * - Text flushed to main process as it's produced
 */
import { join } from 'node:path'

const homePath = process.env.HOME ?? process.env.USERPROFILE ?? ''
const MODEL_ID = 'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processor: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let BaseStreamer: any = null

const SAMPLE_RATE = 16000

// Audio buffer fed by incoming IPC messages
let audioBuffer = new Float32Array(0)
let audioResolve: (() => void) | null = null // resolves when new audio arrives
let sessionActive = false

function appendAudio(samples: Float32Array) {
  const merged = new Float32Array(audioBuffer.length + samples.length)
  merged.set(audioBuffer)
  merged.set(samples, audioBuffer.length)
  audioBuffer = merged
  // Wake up the generator if it's waiting for audio
  if (audioResolve) {
    audioResolve()
    audioResolve = null
  }
}

function waitForAudio(): Promise<void> {
  return new Promise((resolve) => {
    audioResolve = resolve
  })
}

async function loadModel() {
  if (model && processor) return
  console.log('[voxtral-child] Loading Voxtral model...')
  process.parentPort.postMessage({ type: 'status', status: 'loading' })

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const transformers = require('@huggingface/transformers')
  const { VoxtralRealtimeForConditionalGeneration, VoxtralRealtimeProcessor, env } = transformers
  BaseStreamer = transformers.BaseStreamer

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

async function runStreamingSession() {
  await loadModel()
  sessionActive = true
  audioBuffer = new Float32Array(0)

  const hop = processor.feature_extractor.config.hop_length
  const nfft = processor.feature_extractor.config.n_fft
  const numSamplesFirst = processor.num_samples_first_audio_chunk
  const numSamplesPerChunk = processor.num_samples_per_audio_chunk
  const samplesPerTok = processor.audio_length_per_tok * hop
  const numMelFirst = processor.num_mel_frames_first_audio_chunk
  const winHalf = Math.floor(nfft / 2)

  // Wait for enough audio for the first chunk
  while (audioBuffer.length < numSamplesFirst && sessionActive) {
    await waitForAudio()
  }
  if (!sessionActive) return

  const firstChunkInputs = await processor(audioBuffer.subarray(0, numSamplesFirst), {
    is_streaming: true,
    is_first_audio_chunk: true,
  })

  let melFrameIdx = numMelFirst
  let startIdx = melFrameIdx * hop - winHalf

  // Async generator that yields features as audio arrives
  async function* inputFeaturesGenerator() {
    yield firstChunkInputs.input_features

    while (sessionActive) {
      // Wait until we have enough audio for the next chunk
      const endNeeded = startIdx + numSamplesPerChunk
      while (audioBuffer.length < endNeeded && sessionActive) {
        await waitForAudio()
      }
      if (!sessionActive) return

      // Consume as much available audio as possible (token-aligned)
      let batchEnd = Math.min(endNeeded, audioBuffer.length)
      while (batchEnd + samplesPerTok <= audioBuffer.length) {
        batchEnd += samplesPerTok
      }
      if (batchEnd <= startIdx) {
        await waitForAudio()
        continue
      }

      // Pad to align mel_frames % 8 == 0
      let chunkAudio = audioBuffer.slice(startIdx, batchEnd)
      const rawMel = Math.floor((chunkAudio.length - nfft) / hop)
      const rem = rawMel % 8
      if (rem !== 0) {
        const padded = new Float32Array(chunkAudio.length + (8 - rem) * hop)
        padded.set(chunkAudio)
        chunkAudio = padded
      }

      const chunkInputs = await processor(chunkAudio, {
        is_streaming: true,
        is_first_audio_chunk: false,
      })
      yield chunkInputs.input_features

      melFrameIdx += chunkInputs.input_features.dims[2]
      startIdx = melFrameIdx * hop - winHalf
    }
  }

  // Streamer that emits text incrementally (like the WebGPU demo)
  const tokenizer = processor.tokenizer
  const specialIds = new Set(tokenizer.all_special_ids.map(BigInt))
  let tokenCache: bigint[] = []
  let printLen = 0
  let isPrompt = true

  const streamer = new (class extends BaseStreamer {
    put(value: bigint[][]) {
      if (!sessionActive) return
      if (isPrompt) {
        isPrompt = false
        return
      }
      const tokens = value[0]
      if (tokens.length === 1 && specialIds.has(tokens[0])) return
      tokenCache = tokenCache.concat(tokens)
      // Decode and emit new text
      const text = tokenizer.decode(tokenCache, { skip_special_tokens: true })
      const newText = text.slice(printLen)
      printLen = text.length
      if (newText.length > 0) {
        process.parentPort.postMessage({ type: 'flush', text: newText })
      }
    }
    end() {
      // Flush remaining
      if (tokenCache.length > 0) {
        const text = tokenizer.decode(tokenCache, { skip_special_tokens: true })
        const newText = text.slice(printLen)
        if (newText.length > 0) {
          process.parentPort.postMessage({ type: 'flush', text: newText })
        }
      }
      tokenCache = []
      printLen = 0
      isPrompt = true
    }
  })()

  try {
    await model.generate({
      input_ids: firstChunkInputs.input_ids,
      input_features: inputFeaturesGenerator(),
      max_new_tokens: 4096,
      temperature: 0.0,
      do_sample: false,
      streamer,
    })
  } catch (err: any) {
    if (sessionActive) {
      console.error('[voxtral-child] generate error:', err?.message ?? err)
    }
  }

  sessionActive = false
}

// Handle messages from main process
process.parentPort.on('message', async (e: Electron.MessageEvent) => {
  const { id, buffer } = e.data as { id: number; buffer: ArrayBuffer }

  const samples = new Float32Array(buffer)
  appendAudio(samples)

  // Start streaming session on first audio chunk
  if (!sessionActive) {
    // Fire and forget — the session runs until stopped
    runStreamingSession().catch((err) => {
      console.error('[voxtral-child] session error:', err)
      sessionActive = false
    })
  }

  // Respond immediately — text comes via 'flush' messages
  process.parentPort.postMessage({ id, text: '' })
})
