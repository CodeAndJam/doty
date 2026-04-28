/**
 * voxtral-worker.ts
 * Worker thread for Voxtral Mini 4B Realtime transcription.
 * Uses @huggingface/transformers with ONNX weights (q4f16 quantized).
 *
 * Unlike the sherpa-onnx worker, Voxtral is an LLM-based ASR model
 * that uses generate() to produce text from audio features.
 */

import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'

const { appPath, homePath } = workerData as { appPath: string; homePath: string }

const MODEL_ID = 'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processor: any = null

async function loadModel() {
  if (model && processor) return
  console.log('[voxtral-worker] Loading Voxtral model...')
  parentPort!.postMessage({ type: 'status', status: 'loading' })

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const transformers = require(join(appPath, 'node_modules/@huggingface/transformers/dist/transformers.node.cjs'))
  const { VoxtralRealtimeForConditionalGeneration, VoxtralRealtimeProcessor, env } = transformers

  env.cacheDir = join(homePath, '.doty', 'hf-cache')
  env.allowRemoteModels = true

  processor = await VoxtralRealtimeProcessor.from_pretrained(MODEL_ID)
  model = await VoxtralRealtimeForConditionalGeneration.from_pretrained(MODEL_ID, {
    dtype: { audio_encoder: 'q4f16', embed_tokens: 'q4f16', decoder_model_merged: 'q4f16' },
    device: 'cpu',
  })

  console.log('[voxtral-worker] Model ready')
  parentPort!.postMessage({ type: 'status', status: 'ready' })
}

async function transcribe(samples: Float32Array): Promise<string> {
  await loadModel()

  const hop = processor.feature_extractor.config.hop_length
  const nfft = processor.feature_extractor.config.n_fft
  const numSamplesFirst = processor.num_samples_first_audio_chunk

  // Ensure audio is at least as long as first chunk
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

  // Pad second chunk so mel_frames % 8 == 0 (encoder stride 2 + projector groups of 4)
  // For center=false: mel_frames = floor((len - n_fft) / hop)
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

parentPort!.on('message', async ({ id, buffer }: { id: number; buffer: ArrayBuffer }) => {
  try {
    const samples = new Float32Array(buffer)
    const text = await transcribe(samples)
    parentPort!.postMessage({ id, text })
  } catch (e) {
    parentPort!.postMessage({ id, error: String(e) })
  }
})
