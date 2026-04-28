/**
 * Integration test: Voxtral Mini 4B Realtime transcription.
 *
 * Loads WAV files from test-fixtures/stt/ and runs them through the
 * Voxtral ONNX model via @huggingface/transformers to verify accuracy.
 *
 * Prerequisites:
 *   - Node.js 20+ with @huggingface/transformers >= 4.0.0
 *   - ~2GB disk for q4f16 ONNX weights (auto-downloaded on first run)
 *   - WAV files in test-fixtures/stt/ with manifest.json
 *
 * Run with:  npx vitest run electron/voxtral-integration.test.ts
 *
 * @vitest-environment node
 */

import fs from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const FIXTURES_DIR = join(__dirname, '..', 'test-fixtures', 'stt')
const MANIFEST_PATH = join(FIXTURES_DIR, 'manifest.json')
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ''

const MODEL_ID = 'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX'

interface TestCase {
  file: string
  language: string
  expected: string
  description: string
  minOverlap?: number
}

// ── WAV parser (same as asr-integration.test.ts) ──────────────────────────────

function readWavAsFloat32(filePath: string): { samples: Float32Array; sampleRate: number } {
  const buf = fs.readFileSync(filePath)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Not a valid WAV file: ${filePath}`)
  }

  let offset = 12
  let sampleRate = 16000
  let bitsPerSample = 16
  let numChannels = 1

  while (offset < buf.length - 8) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)

    if (chunkId === 'fmt ') {
      numChannels = buf.readUInt16LE(offset + 10)
      sampleRate = buf.readUInt32LE(offset + 12)
      bitsPerSample = buf.readUInt16LE(offset + 22)
    }

    if (chunkId === 'data') {
      const dataStart = offset + 8
      const bytesPerSample = bitsPerSample / 8
      const totalSamples = chunkSize / bytesPerSample / numChannels
      const samples = new Float32Array(totalSamples)
      for (let i = 0; i < totalSamples; i++) {
        const sampleOffset = dataStart + i * numChannels * bytesPerSample
        if (bitsPerSample === 16) samples[i] = buf.readInt16LE(sampleOffset) / 32768.0
        else if (bitsPerSample === 32) samples[i] = buf.readFloatLE(sampleOffset)
        else throw new Error(`Unsupported bits per sample: ${bitsPerSample}`)
      }
      return { samples, sampleRate }
    }

    offset += 8 + chunkSize
    if (chunkSize % 2 !== 0) offset++
  }
  throw new Error(`No data chunk found in WAV file: ${filePath}`)
}

function resampleTo16k(samples: Float32Array, fromRate: number): Float32Array {
  if (fromRate === 16000) return samples
  const ratio = fromRate / 16000
  const outLen = Math.floor(samples.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio
    const lo = Math.floor(srcIdx)
    const hi = Math.min(lo + 1, samples.length - 1)
    const frac = srcIdx - lo
    out[i] = samples[lo] * (1 - frac) + samples[hi] * frac
  }
  return out
}

function wordOverlapRatio(expected: string, actual: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter(Boolean)

  const expectedWords = normalize(expected)
  const actualWords = normalize(actual)
  if (expectedWords.length === 0) return actualWords.length === 0 ? 1 : 0

  let matches = 0
  const remaining = [...actualWords]
  for (const word of expectedWords) {
    const idx = remaining.indexOf(word)
    if (idx !== -1) {
      matches++
      remaining.splice(idx, 1)
    }
  }
  return matches / expectedWords.length
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('ASR STT integration — Voxtral Mini 4B Realtime', { timeout: 600_000 }, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let model: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let processor: any = null
  let manifest: TestCase[] = []

  beforeAll(async () => {
    if (!fs.existsSync(MANIFEST_PATH)) return
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'))
    manifest = manifest.filter((tc) => fs.existsSync(join(FIXTURES_DIR, tc.file)))
    if (manifest.length === 0) return

    try {
      const { VoxtralRealtimeForConditionalGeneration, VoxtralRealtimeProcessor, env } = await import(
        '@huggingface/transformers'
      )

      env.cacheDir = join(HOME, '.doty', 'hf-cache')
      env.allowRemoteModels = true

      console.log('[voxtral] Loading processor...')
      processor = await VoxtralRealtimeProcessor.from_pretrained(MODEL_ID)

      console.log('[voxtral] Loading model (q4f16, CPU)...')
      model = await VoxtralRealtimeForConditionalGeneration.from_pretrained(MODEL_ID, {
        dtype: {
          audio_encoder: 'q4f16',
          embed_tokens: 'q4f16',
          decoder_model_merged: 'q4f16',
        },
        device: 'cpu',
      })

      console.log(`[voxtral] loaded, ${manifest.length} test case(s)`)
    } catch (e) {
      console.warn('[voxtral] Failed to load model, skipping:', e)
      model = null
    }
  }, 600_000)

  it('transcribes each WAV file with acceptable accuracy', async () => {
    if (!model || !processor || manifest.length === 0) {
      console.warn('[voxtral] model not loaded or no test cases, skipping')
      return
    }

    for (const tc of manifest) {
      const { samples: rawSamples, sampleRate } = readWavAsFloat32(join(FIXTURES_DIR, tc.file))
      const samples = resampleTo16k(rawSamples, sampleRate)

      // Use streaming API: first chunk gets input_ids + input_features,
      // then feed remaining audio as subsequent chunks via a generator.
      const runtimeProcessor = processor as any
      const numSamplesFirst = runtimeProcessor.num_samples_first_audio_chunk
      const { hop_length } = runtimeProcessor.feature_extractor.config
      const samplesPerTok = runtimeProcessor.audio_length_per_tok * hop_length

      // Use streaming API with alignment padding.
      // The ONNX projector requires each chunk's encoder output to be divisible by 4.
      // Encoder conv has stride 2, so each chunk's mel_frames must be divisible by 8.
      // First chunk always produces numMelFramesFirst (56) which is div by 8.
      // We feed all remaining audio as one second chunk, padded to align.
      // For center=false: mel_frames = floor((len - n_fft) / hop)

      const nfft = runtimeProcessor.feature_extractor.config.n_fft

      // Ensure audio is at least as long as first chunk
      let paddedSamples = samples
      if (samples.length < numSamplesFirst + nfft + hop_length) {
        paddedSamples = new Float32Array(numSamplesFirst + nfft + hop_length * 8)
        paddedSamples.set(samples)
      }

      const firstChunkInputs = await runtimeProcessor(paddedSamples.subarray(0, numSamplesFirst), {
        is_streaming: true,
        is_first_audio_chunk: true,
      })

      const numMelFramesFirst = runtimeProcessor.num_mel_frames_first_audio_chunk
      const winHalf = Math.floor(nfft / 2)
      const startIdx = numMelFramesFirst * hop_length - winHalf

      // Pad second chunk so its mel_frames are divisible by 8
      let secondChunkAudio = paddedSamples.slice(startIdx)
      const rawMelFrames = Math.floor((secondChunkAudio.length - nfft) / hop_length)
      const rem = rawMelFrames % 8
      if (rem !== 0) {
        const extra = (8 - rem) * hop_length
        const padded = new Float32Array(secondChunkAudio.length + extra)
        padded.set(secondChunkAudio)
        secondChunkAudio = padded
      }

      async function* inputFeaturesGenerator() {
        yield firstChunkInputs.input_features
        const chunkInputs = await runtimeProcessor(secondChunkAudio, {
          is_streaming: true,
          is_first_audio_chunk: false,
        })
        yield chunkInputs.input_features
      }

      const outputs = await (model as any).generate({
        input_ids: firstChunkInputs.input_ids,
        input_features: inputFeaturesGenerator(),
        max_new_tokens: 4096,
      })

      const decoded = runtimeProcessor.tokenizer.batch_decode(outputs, { skip_special_tokens: true })
      const actual = (decoded[0] ?? '').trim()

      const ov = wordOverlapRatio(tc.expected, actual)
      // Voxtral is a strong multilingual model — use 50% threshold
      const threshold = tc.minOverlap ?? 0.5
      const pass = ov >= threshold

      console.log(
        `[voxtral] ${pass ? 'PASS' : 'FAIL'} ${tc.file} (${tc.language})` +
          `\n  expected: "${tc.expected}"` +
          `\n  actual:   "${actual}"` +
          `\n  overlap:  ${Math.round(ov * 100)}%`,
      )

      expect(pass, `${tc.file}: expected "${tc.expected}", got "${actual}" (${Math.round(ov * 100)}% overlap)`).toBe(
        true,
      )
    }
  })
})
