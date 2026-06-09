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
let sessionStarting = false

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

let loadPromise: Promise<void> | null = null

async function loadModel() {
  if (model && processor) return
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
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
  })()
  return loadPromise
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
  const _winHalf = Math.floor(nfft / 2)

  // Wait for enough audio for the first chunk
  while (audioBuffer.length < numSamplesFirst && sessionActive) {
    await waitForAudio()
  }
  if (!sessionActive) return

  const firstChunkInputs = await processor(audioBuffer.subarray(0, numSamplesFirst), {
    is_streaming: true,
    is_first_audio_chunk: true,
  })

  let _melFrameIdx = numMelFirst

  // Async generator that yields features as audio arrives
  async function* inputFeaturesGenerator() {
    yield firstChunkInputs.input_features

    // Trim audio already consumed by the first chunk
    audioBuffer = audioBuffer.slice(numSamplesFirst)
    let audioConsumed = 0 // tracks how much of current audioBuffer has been consumed

    while (sessionActive) {
      // Wait until we have enough audio for the next chunk
      const needed = audioConsumed + numSamplesPerChunk
      while (audioBuffer.length < needed && sessionActive) {
        await waitForAudio()
      }
      if (!sessionActive) return

      // Skip stale audio if backlog exceeds 1.5 seconds (prevents latency spiral)
      const backlog = audioBuffer.length - audioConsumed
      if (backlog > SAMPLE_RATE * 1.5) {
        audioConsumed = audioBuffer.length - SAMPLE_RATE * 0.5 // keep latest 0.5s
      }

      // Feed fixed-size chunks to keep latency bounded (cap at 1s)
      let batchEnd = Math.min(audioConsumed + numSamplesPerChunk, audioBuffer.length)
      while (batchEnd + samplesPerTok <= Math.min(audioConsumed + SAMPLE_RATE, audioBuffer.length)) {
        batchEnd += samplesPerTok
      }
      if (batchEnd <= audioConsumed) {
        await waitForAudio()
        continue
      }

      // Pad to align mel_frames % 8 == 0
      let chunkAudio = audioBuffer.slice(audioConsumed, batchEnd)
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

      _melFrameIdx += chunkInputs.input_features.dims[2]
      audioConsumed = batchEnd

      // Trim consumed audio to prevent unbounded memory growth
      if (audioConsumed > SAMPLE_RATE * 10) {
        audioBuffer = audioBuffer.slice(audioConsumed)
        audioConsumed = 0
      }
    }
  }

  // Streamer that emits text incrementally (like the WebGPU demo)
  const tokenizer = processor.tokenizer
  const specialIds = new Set(tokenizer.all_special_ids.map(BigInt))
  let tokenCache: bigint[] = []
  let printLen = 0
  let isPrompt = true
  let textBuffer = ''
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  function flushText() {
    if (textBuffer.length > 0) {
      // Send as final (locked-in) text
      process.parentPort.postMessage({ type: 'flush', text: textBuffer })
      textBuffer = ''
      // Reset token cache to prevent unbounded memory growth
      tokenCache = []
      printLen = 0
    }
    flushTimer = null
  }

  function emitInterim() {
    // Send current buffer as interim (speculative, may change)
    process.parentPort.postMessage({ type: 'interim', text: textBuffer })
  }

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer)
    // 2s without new tokens = finalize what we have
    flushTimer = setTimeout(flushText, 2000)
  }

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
      const text = tokenizer.decode(tokenCache, { skip_special_tokens: true })
      const newText = text.slice(printLen)
      printLen = text.length
      if (newText.length > 0) {
        textBuffer += newText
        // Emit interim immediately so UI updates in real-time
        emitInterim()
        // Finalize on sentence-ending punctuation with enough content
        if (textBuffer.length > 40 && /[.!?]\s*$/.test(textBuffer)) {
          if (flushTimer) clearTimeout(flushTimer)
          flushText()
        } else {
          scheduleFlush()
        }
        // Cap token cache to prevent O(n²) decode cost
        if (tokenCache.length > 20) {
          tokenCache = []
          printLen = 0
        }
      }
    }
    end() {
      if (tokenCache.length > 0) {
        const text = tokenizer.decode(tokenCache, { skip_special_tokens: true })
        const newText = text.slice(printLen)
        if (newText.length > 0) textBuffer += newText
      }
      if (flushTimer) clearTimeout(flushTimer)
      flushText()
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

  // Start streaming session on first audio chunk (or restart if previous ended)
  if (!sessionActive && !sessionStarting) {
    sessionStarting = true
    runStreamingSession()
      .catch((err) => {
        console.error('[voxtral-child] session error:', err)
      })
      .finally(() => {
        sessionActive = false
        sessionStarting = false
      })
  }

  // Respond immediately — text comes via 'flush' messages
  process.parentPort.postMessage({ id, text: '' })
})
