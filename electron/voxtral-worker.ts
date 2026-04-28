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
  const transformers = require(
    join(appPath, 'node_modules/@huggingface/transformers/dist/transformers.node.cjs'),
  )
  const { VoxtralRealtimeForConditionalGeneration, VoxtralRealtimeProcessor, env } = transformers

  env.cacheDir = join(homePath, '.doty', 'hf-cache')
  env.allowRemoteModels = true

  processor = await VoxtralRealtimeProcessor.from_pretrained(MODEL_ID)
  model = await VoxtralRealtimeForConditionalGeneration.from_pretrained(MODEL_ID, {
    dtype: {
      audio_encoder: 'q4f16',
      embed_tokens: 'q4f16',
      decoder_model_merged: 'q4f16',
    },
    device: 'cpu',
  })

  console.log('[voxtral-worker] Model ready')
  parentPort!.postMessage({ type: 'status', status: 'ready' })
}

async function transcribe(samples: Float32Array): Promise<string> {
  await loadModel()

  const { hop_length, n_fft } = processor.feature_extractor.config
  const samplesPerTok = processor.audio_length_per_tok * hop_length
  const numSamplesFirst = processor.num_samples_first_audio_chunk

  const firstChunkEnd = Math.min(numSamplesFirst, samples.length)
  const firstChunkInputs = await processor(
    samples.subarray(0, firstChunkEnd),
    { is_streaming: true, is_first_audio_chunk: true },
  )

  const numMelFramesFirst = processor.num_mel_frames_first_audio_chunk
  const winHalf = Math.floor(n_fft / 2)

  async function* inputFeaturesGenerator() {
    yield firstChunkInputs.input_features
    let melFrameIdx = numMelFramesFirst
    let startIdx = melFrameIdx * hop_length - winHalf
    while (startIdx < samples.length) {
      const endNeeded = startIdx + processor.num_samples_per_audio_chunk
      let batchEndSample = Math.min(endNeeded, samples.length)
      while (batchEndSample + samplesPerTok <= samples.length) {
        batchEndSample += samplesPerTok
      }
      if (batchEndSample <= startIdx) break
      const chunkInputs = await processor(
        samples.slice(startIdx, batchEndSample),
        { is_streaming: true, is_first_audio_chunk: false },
      )
      yield chunkInputs.input_features
      melFrameIdx += chunkInputs.input_features.dims[2]
      startIdx = melFrameIdx * hop_length - winHalf
    }
  }

  const outputs = await model.generate({
    input_ids: firstChunkInputs.input_ids,
    input_features: inputFeaturesGenerator(),
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
