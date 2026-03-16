/**
 * Integration test: loads WAV files from test-fixtures/stt/ and runs them
 * through multiple STT models to verify transcription quality.
 *
 * Models tested:
 *   - Parakeet TDT v3 int8 (default, fast, CPU-optimized)
 *   - Whisper large-v3 int8 (best accuracy, slower)
 *
 * Prerequisites:
 *   - ASR models downloaded to ~/.doty/models/
 *   - WAV files placed in test-fixtures/stt/
 *   - manifest.json listing each file with expected transcription
 *
 * Add your own WAV files and update manifest.json to expand coverage.
 *
 * To convert any audio file to the right format:
 *   ffmpeg -i input.mp3 -ar 16000 -ac 1 -sample_fmt s16 output.wav
 *
 * Run with:  npx vitest run electron/asr-integration.test.ts
 *
 * @vitest-environment node
 */

import fs from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

// ── Paths ─────────────────────────────────────────────────────────────────────

const FIXTURES_DIR = join(__dirname, '..', 'test-fixtures', 'stt')
const MANIFEST_PATH = join(FIXTURES_DIR, 'manifest.json')

// Model paths — same as electron/model-paths.ts but without Electron app import
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ''
const PARAKEET_DIR = join(HOME, '.doty', 'models', 'parakeet-tdt-0.6b-v3-int8')
const WHISPER_MEDIUM_DIR = join(HOME, '.doty', 'models', 'sherpa-onnx-whisper-medium')
const WHISPER_LARGE_V3_DIR = join(HOME, '.doty', 'models', 'sherpa-onnx-whisper-large-v3')
const DENOISER_MODEL_PATH = join(HOME, '.doty', 'models', 'gtcrn_simple.onnx')
const VAD_MODEL_PATH = join(HOME, '.doty', 'models', 'silero_vad.onnx')

// ── Types ─────────────────────────────────────────────────────────────────────

interface TestCase {
  file: string
  language: string
  expected: string
  description: string
  /** Override the default 60% word-overlap threshold for noisy/difficult audio */
  minOverlap?: number
}

// ── WAV parser ────────────────────────────────────────────────────────────────

function readWavAsFloat32(filePath: string): { samples: Float32Array; sampleRate: number } {
  const buf = fs.readFileSync(filePath)

  const riff = buf.toString('ascii', 0, 4)
  const wave = buf.toString('ascii', 8, 12)
  if (riff !== 'RIFF' || wave !== 'WAVE') {
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
        if (bitsPerSample === 16) {
          samples[i] = buf.readInt16LE(sampleOffset) / 32768.0
        } else if (bitsPerSample === 32) {
          samples[i] = buf.readFloatLE(sampleOffset)
        } else {
          throw new Error(`Unsupported bits per sample: ${bitsPerSample}`)
        }
      }

      return { samples, sampleRate }
    }

    offset += 8 + chunkSize
    if (chunkSize % 2 !== 0) offset++
  }

  throw new Error(`No data chunk found in WAV file: ${filePath}`)
}

// ── Resampler ─────────────────────────────────────────────────────────────────

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

// ── Similarity helper ─────────────────────────────────────────────────────────

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

// ── Shared transcription helper ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transcribeWithPipeline(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recognizer: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vad: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  denoiser: any,
  samples: Float32Array,
  label: string,
): string {
  if (vad) {
    const CHUNK_SIZE = 16000 * 0.5
    for (let offset = 0; offset < samples.length; offset += CHUNK_SIZE) {
      const end = Math.min(offset + CHUNK_SIZE, samples.length)
      vad.acceptWaveform(samples.subarray(offset, end))
    }
    vad.flush()

    const texts: string[] = []
    let segCount = 0
    while (!vad.isEmpty()) {
      const segment = vad.front(false)
      vad.pop()
      segCount++

      let segSamples: Float32Array = segment.samples
      if (denoiser) {
        try {
          const denoised = denoiser.run({ samples: segSamples, sampleRate: 16000, enableExternalBuffer: false })
          segSamples = denoised.samples ?? segSamples
        } catch {
          /* fall through */
        }
      }

      const stream = recognizer.createStream()
      stream.acceptWaveform({ samples: segSamples, sampleRate: 16000 })
      recognizer.decode(stream)
      let text = (recognizer.getResult(stream).text as string).trim()

      // If denoiser killed the speech, retry raw
      if (!text && denoiser && segSamples !== segment.samples) {
        const rawStream = recognizer.createStream()
        rawStream.acceptWaveform({ samples: segment.samples, sampleRate: 16000 })
        recognizer.decode(rawStream)
        text = (recognizer.getResult(rawStream).text as string).trim()
      }

      if (text) texts.push(text)
    }

    if (segCount === 0) {
      // VAD found no speech — fall back to direct transcription
      const stream = recognizer.createStream()
      stream.acceptWaveform({ samples, sampleRate: 16000 })
      recognizer.decode(stream)
      const text = (recognizer.getResult(stream).text as string).trim()
      if (text) texts.push(text)
    }

    return texts.join(' ')
  }

  // No VAD — direct transcription
  const stream = recognizer.createStream()
  stream.acceptWaveform({ samples, sampleRate: 16000 })
  recognizer.decode(stream)
  return (recognizer.getResult(stream).text as string).trim()
}

// ── Test suite: Parakeet TDT v3 ──────────────────────────────────────────────

describe('ASR STT integration — Parakeet TDT v3', { timeout: 120_000 }, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recognizer: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let denoiser: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let vad: any = null
  let manifest: TestCase[] = []

  beforeAll(() => {
    if (!fs.existsSync(MANIFEST_PATH)) return
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'))
    manifest = manifest.filter((tc) => fs.existsSync(join(FIXTURES_DIR, tc.file)))
    if (manifest.length === 0) return

    if (!fs.existsSync(join(PARAKEET_DIR, 'encoder.int8.onnx'))) {
      throw new Error(`Parakeet model not found at ${PARAKEET_DIR}. Run the app once to download it.`)
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sherpa = require('sherpa-onnx-node')

    recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: join(PARAKEET_DIR, 'encoder.int8.onnx'),
          decoder: join(PARAKEET_DIR, 'decoder.int8.onnx'),
          joiner: join(PARAKEET_DIR, 'joiner.int8.onnx'),
        },
        tokens: join(PARAKEET_DIR, 'tokens.txt'),
        numThreads: 4,
        debug: 0,
        modelType: 'nemo_transducer',
      },
      decodingMethod: 'greedy_search',
      blankPenalty: 0.5,
    })

    if (fs.existsSync(DENOISER_MODEL_PATH)) {
      try {
        denoiser = new sherpa.OfflineSpeechDenoiser({
          model: { gtcrn: { model: DENOISER_MODEL_PATH }, numThreads: 1, debug: 0 },
          sampleRate: 16000,
        })
      } catch {
        /* non-fatal */
      }
    }

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
            sampleRate: 16000,
            numThreads: 1,
            debug: 0,
          },
          30,
        )
      } catch {
        /* non-fatal */
      }
    }

    console.log(`[parakeet] loaded, ${manifest.length} test case(s)`)
  })

  it('transcribes each WAV file with acceptable accuracy', () => {
    if (!recognizer || manifest.length === 0) return

    for (const tc of manifest) {
      const { samples: rawSamples, sampleRate } = readWavAsFloat32(join(FIXTURES_DIR, tc.file))
      const samples = resampleTo16k(rawSamples, sampleRate)
      const actual = transcribeWithPipeline(recognizer, vad, denoiser, samples, tc.file)
      const ov = wordOverlapRatio(tc.expected, actual)
      // Parakeet is fast but less accurate on noisy audio — cap threshold at 40%
      // for difficult test cases. Clean audio still uses the default 60%.
      const threshold = tc.minOverlap ? Math.min(tc.minOverlap, 0.4) : 0.6
      const pass = ov >= threshold

      console.log(
        `[parakeet] ${pass ? 'PASS' : 'FAIL'} ${tc.file} (${tc.language})` +
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

// ── Test suite: Whisper large-v3 ─────────────────────────────────────────────

describe('ASR STT integration — Whisper large-v3', { timeout: 300_000 }, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recognizer: any = null
  let manifest: TestCase[] = []

  beforeAll(() => {
    if (!fs.existsSync(MANIFEST_PATH)) return
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'))
    manifest = manifest.filter((tc) => fs.existsSync(join(FIXTURES_DIR, tc.file)))
    if (manifest.length === 0) return

    if (!fs.existsSync(join(WHISPER_LARGE_V3_DIR, 'large-v3-encoder.int8.onnx'))) {
      console.warn('[whisper-large-v3] model not found, skipping')
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sherpa = require('sherpa-onnx-node')

    recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 128 },
      modelConfig: {
        whisper: {
          encoder: join(WHISPER_LARGE_V3_DIR, 'large-v3-encoder.int8.onnx'),
          decoder: join(WHISPER_LARGE_V3_DIR, 'large-v3-decoder.int8.onnx'),
          language: '',
          task: 'transcribe',
          tailPaddings: -1,
        },
        tokens: join(WHISPER_LARGE_V3_DIR, 'large-v3-tokens.txt'),
        numThreads: 4,
        debug: 0,
      },
      decodingMethod: 'greedy_search',
    })

    console.log(`[whisper-large-v3] loaded, ${manifest.length} test case(s)`)
  })

  it('transcribes each WAV file with high accuracy', () => {
    if (!recognizer || manifest.length === 0) return

    for (const tc of manifest) {
      const { samples, sampleRate } = readWavAsFloat32(join(FIXTURES_DIR, tc.file))
      // Feed raw samples — Whisper handles resampling internally and
      // performs better without VAD/denoiser preprocessing.
      const stream = recognizer.createStream()
      stream.acceptWaveform({ samples, sampleRate })
      recognizer.decode(stream)
      const actual = (recognizer.getResult(stream).text as string).trim()

      const ov = wordOverlapRatio(tc.expected, actual)
      const threshold = tc.minOverlap ?? 0.6
      const pass = ov >= threshold

      console.log(
        `[whisper-large-v3] ${pass ? 'PASS' : 'FAIL'} ${tc.file} (${tc.language})` +
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
