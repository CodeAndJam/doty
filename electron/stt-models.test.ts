/**
 * Component test: verifies ALL registered STT models can transcribe audio.
 * Skips models that aren't downloaded. Uses the shortest fixture for speed.
 *
 * Run with:  npx vitest run electron/stt-models.test.ts
 *
 * @vitest-environment node
 */

import fs from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FIXTURES_DIR = join(__dirname, '..', 'test-fixtures', 'stt')
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ''

const MODELS = [
  {
    id: 'parakeet',
    dir: join(HOME, '.doty', 'models', 'parakeet-tdt-0.6b-v3-int8'),
    engine: 'sherpa-onnx',
    featureDim: 80,
  },
  {
    id: 'whisper-medium',
    dir: join(HOME, '.doty', 'models', 'sherpa-onnx-whisper-medium'),
    engine: 'sherpa-onnx',
    featureDim: 128,
  },
  {
    id: 'whisper-large-v3',
    dir: join(HOME, '.doty', 'models', 'sherpa-onnx-whisper-large-v3'),
    engine: 'sherpa-onnx',
    featureDim: 128,
  },
  {
    id: 'voxtral',
    dir: join(HOME, '.doty', 'hf-cache'),
    engine: 'transformers',
    featureDim: 0,
  },
] as const

const VAD_MODEL_PATH = join(HOME, '.doty', 'models', 'silero_vad.onnx')
const DENOISER_MODEL_PATH = join(HOME, '.doty', 'models', 'gtcrn_simple.onnx')

interface TestCase {
  file: string
  expected: string
  language: string
  minOverlap?: number
}

function readWavAsFloat32(filePath: string): { samples: Float32Array; sampleRate: number } {
  const buf = fs.readFileSync(filePath)
  let offset = 12
  let sampleRate = 16000
  let bitsPerSample = 16
  let numChannels = 1
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4)
    const sz = buf.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      numChannels = buf.readUInt16LE(offset + 10)
      sampleRate = buf.readUInt32LE(offset + 12)
      bitsPerSample = buf.readUInt16LE(offset + 22)
    }
    if (id === 'data') {
      const start = offset + 8
      const total = sz / (bitsPerSample / 8) / numChannels
      const samples = new Float32Array(total)
      for (let i = 0; i < total; i++) {
        samples[i] = buf.readInt16LE(start + i * numChannels * (bitsPerSample / 8)) / 32768.0
      }
      return { samples, sampleRate }
    }
    offset += 8 + sz
    if (sz % 2 !== 0) offset++
  }
  throw new Error('No data chunk')
}

function wordOverlap(expected: string, actual: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean)
  const exp = norm(expected)
  const act = norm(actual)
  if (exp.length === 0) return act.length === 0 ? 1 : 0
  let matches = 0
  const remaining = [...act]
  for (const w of exp) {
    const idx = remaining.indexOf(w)
    if (idx !== -1) { matches++; remaining.splice(idx, 1) }
  }
  return matches / exp.length
}

describe('STT models transcription', { timeout: 600_000 }, () => {
  const manifest: TestCase[] = fs.existsSync(join(FIXTURES_DIR, 'manifest.json'))
    ? JSON.parse(fs.readFileSync(join(FIXTURES_DIR, 'manifest.json'), 'utf-8'))
    : []
  // Use shortest fixture for speed
  const testCase = manifest.find((tc) => fs.existsSync(join(FIXTURES_DIR, tc.file)))

  if (!testCase) {
    it.skip('no test fixtures available', () => {})
    return
  }

  const { samples, sampleRate } = readWavAsFloat32(join(FIXTURES_DIR, testCase.file))

  // --- Sherpa-onnx models ---
  for (const model of MODELS.filter((m) => m.engine === 'sherpa-onnx')) {
    const modelReady = fs.existsSync(model.dir) && fs.readdirSync(model.dir).length > 0

    it(`${model.id}: transcribes audio with acceptable accuracy`, async () => {
      if (!modelReady) {
        console.log(`[stt-models] ${model.id} not downloaded, skipping`)
        return
      }
      if (!fs.existsSync(VAD_MODEL_PATH)) {
        console.log(`[stt-models] VAD model not found, skipping`)
        return
      }

      const sherpa = await import('sherpa-onnx-node')

      // Build recognizer config based on model type
      let config: any
      if (model.id === 'parakeet') {
        config = {
          featConfig: { sampleRate: 16000, featureDim: 80 },
          modelConfig: {
            transducer: {
              encoder: join(model.dir, 'encoder.int8.onnx'),
              decoder: join(model.dir, 'decoder.int8.onnx'),
              joiner: join(model.dir, 'joiner.int8.onnx'),
            },
            tokens: join(model.dir, 'tokens.txt'),
            numThreads: 4,
            debug: 0,
            modelType: 'nemo_transducer',
          },
          decodingMethod: 'greedy_search',
        }
      } else {
        // Whisper models
        const prefix = model.id === 'whisper-medium' ? 'medium' : 'large-v3'
        const featureDim = model.id === 'whisper-large-v3' ? 128 : 80
        config = {
          featConfig: { sampleRate: 16000, featureDim },
          modelConfig: {
            whisper: {
              encoder: join(model.dir, `${prefix}-encoder.int8.onnx`),
              decoder: join(model.dir, `${prefix}-decoder.int8.onnx`),
              language: '',
              task: 'transcribe',
              tailPaddings: -1,
            },
            tokens: join(model.dir, `${prefix}-tokens.txt`),
            numThreads: 4,
            debug: 0,
          },
          decodingMethod: 'greedy_search',
        }
      }

      const recognizer = new sherpa.OfflineRecognizer(config)
      const stream = recognizer.createStream()
      stream.acceptWaveform({ sampleRate, samples })
      recognizer.decode(stream)
      const text = recognizer.getResult(stream).text.trim()

      console.log(`[stt-models] ${model.id}: "${text.slice(0, 80)}..."`)
      const overlap = wordOverlap(testCase.expected, text)
      console.log(`[stt-models] ${model.id}: overlap=${Math.round(overlap * 100)}%`)

      expect(overlap, `${model.id} word overlap`).toBeGreaterThanOrEqual(testCase.minOverlap ?? 0.5)
      expect(text.length, `${model.id} must produce text`).toBeGreaterThan(0)
    })
  }

  // --- Voxtral (transformers.js) ---
  const voxtralModel = MODELS.find((m) => m.id === 'voxtral')!
  const voxtralCacheExists = fs.existsSync(voxtralModel.dir)

  it('voxtral: transcribes audio with acceptable accuracy', async () => {
    if (!voxtralCacheExists) {
      console.log('[stt-models] voxtral cache not found, skipping')
      return
    }

    const { VoxtralRealtimeForConditionalGeneration, VoxtralRealtimeProcessor, env } = await import('@huggingface/transformers')
    env.cacheDir = join(HOME, '.doty', 'hf-cache')
    env.allowRemoteModels = true

    const processor = await VoxtralRealtimeProcessor.from_pretrained('onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX')
    const model = await VoxtralRealtimeForConditionalGeneration.from_pretrained(
      'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX',
      { dtype: { audio_encoder: 'q4f16', embed_tokens: 'q4f16', decoder_model_merged: 'q4f16' }, device: 'cpu' },
    )

    // Resample to 16kHz if needed
    let audio = samples
    if (sampleRate !== 16000) {
      const ratio = sampleRate / 16000
      const outLen = Math.floor(samples.length / ratio)
      audio = new Float32Array(outLen)
      for (let i = 0; i < outLen; i++) {
        const srcIdx = i * ratio
        const lo = Math.floor(srcIdx)
        audio[i] = samples[lo] * (1 - (srcIdx - lo)) + samples[Math.min(lo + 1, samples.length - 1)] * (srcIdx - lo)
      }
    }

    // Use streaming API (non-streaming doesn't work for this model)
    const hop = processor.feature_extractor.config.hop_length
    const nfft = processor.feature_extractor.config.n_fft
    const numSamplesFirst = processor.num_samples_first_audio_chunk

    const firstInputs = await processor(audio.subarray(0, numSamplesFirst), {
      is_streaming: true, is_first_audio_chunk: true,
    })

    // Process remaining audio as second chunk
    let remaining = audio.slice(numSamplesFirst)
    const rawMel = Math.floor((remaining.length - nfft) / hop)
    const rem = rawMel % 8
    if (rem !== 0) {
      const padded = new Float32Array(remaining.length + (8 - rem) * hop)
      padded.set(remaining)
      remaining = padded
    }
    const secondInputs = await processor(remaining, { is_streaming: true, is_first_audio_chunk: false })

    async function* featureGen() {
      yield firstInputs.input_features
      yield secondInputs.input_features
    }

    const output = await model.generate({
      input_ids: firstInputs.input_ids,
      input_features: featureGen(),
      max_new_tokens: 512,
      temperature: 0.0,
      do_sample: false,
    })
    const text = processor.tokenizer.decode(output[0], { skip_special_tokens: true }).trim()

    console.log(`[stt-models] voxtral: "${text.slice(0, 80)}..."`)
    const overlap = wordOverlap(testCase.expected, text)
    console.log(`[stt-models] voxtral: overlap=${Math.round(overlap * 100)}%`)

    expect(overlap, 'voxtral word overlap').toBeGreaterThanOrEqual(testCase.minOverlap ?? 0.5)
    expect(text.length, 'voxtral must produce text').toBeGreaterThan(0)
  })
})
