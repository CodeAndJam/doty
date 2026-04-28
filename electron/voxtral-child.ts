/**
 * voxtral-child.ts
 * Runs as an Electron utilityProcess child with its own V8 heap.
 * This avoids OOM crashes from loading the 4B-parameter Voxtral model
 * in the main process's limited worker thread heap.
 *
 * Uses process.parentPort for IPC (not process.send).
 */
import { join } from 'node:path'

const homePath = process.env.HOME ?? process.env.USERPROFILE ?? ''

const MODEL_ID = 'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processor: any = null

async function loadModel() {
  if (model && processor) return
  console.log('[voxtral-child] Loading Voxtral model...')
  process.parentPort.postMessage({ type: 'status', status: 'loading' })

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    VoxtralRealtimeForConditionalGeneration,
    VoxtralRealtimeProcessor,
    env,
  } = require('@huggingface/transformers')

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

async function transcribe(samples: Float32Array): Promise<string> {
  await loadModel()

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

  // Pad second chunk so mel_frames % 8 == 0
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

  const outputs = await model.generate({
    input_ids: firstChunk.input_ids,
    input_features: featureGen(),
    max_new_tokens: 4096,
  })

  const decoded = processor.tokenizer.batch_decode(outputs, { skip_special_tokens: true })
  return (decoded[0] ?? '').trim()
}

process.parentPort.on('message', async (e: Electron.MessageEvent) => {
  const { id, buffer } = e.data as { id: number; buffer: ArrayBuffer }
  console.log(`[voxtral-child] received message id=${id} buffer=${buffer?.byteLength ?? 0} bytes`)
  try {
    const samples = new Float32Array(buffer)
    const text = await transcribe(samples)
    console.log(`[voxtral-child] transcribed id=${id}: "${text.slice(0, 50)}"`)
    process.parentPort.postMessage({ id, text })
  } catch (err) {
    process.parentPort.postMessage({ id, error: String(err) })
  }
})
