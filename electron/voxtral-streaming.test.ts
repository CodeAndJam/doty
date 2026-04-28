/**
 * Streaming integration test: measures Voxtral transcription accuracy
 * and latency when audio is delivered in real-time 1-second chunks.
 *
 * Metrics:
 *   - Time to first token (TTFT): how long until first text appears
 *   - Total latency: time from last audio chunk to final text
 *   - Word overlap ratio: accuracy vs expected transcription
 *
 * Run with:  npx vitest run electron/voxtral-streaming.test.ts
 *
 * @vitest-environment node
 */

import fs from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FIXTURES_DIR = join(__dirname, '..', 'test-fixtures', 'stt')
const MANIFEST_PATH = join(FIXTURES_DIR, 'manifest.json')
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ''
const SAMPLE_RATE = 16000
const CHUNK_DURATION_S = 1 // simulate 1-second chunks like the app

interface TestCase {
  file: string
  language: string
  expected: string
  description: string
  minOverlap?: number
}

function readWavAsFloat32(filePath: string): { samples: Float32Array; sampleRate: number } {
  const buf = fs.readFileSync(filePath)
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
      }
      return { samples, sampleRate }
    }
    offset += 8 + chunkSize
    if (chunkSize % 2 !== 0) offset++
  }
  throw new Error(`No data chunk found: ${filePath}`)
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
    s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean)
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

describe('Voxtral streaming latency and accuracy', { timeout: 600_000 }, () => {
  let model: any = null
  let processor: any = null
  let BaseStreamer: any = null
  let manifest: TestCase[] = []

  // Load model once for all tests
  it('loads model and runs streaming test', async () => {
    if (!fs.existsSync(MANIFEST_PATH)) return
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'))
    manifest = manifest.filter((tc) => fs.existsSync(join(FIXTURES_DIR, tc.file)))
    if (manifest.length === 0) return

    // Load model
    const transformers = await import('@huggingface/transformers')
    const { VoxtralRealtimeForConditionalGeneration, VoxtralRealtimeProcessor, env } = transformers
    BaseStreamer = transformers.BaseStreamer
    env.cacheDir = join(HOME, '.doty', 'hf-cache')
    env.allowRemoteModels = true

    processor = await VoxtralRealtimeProcessor.from_pretrained('onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX')
    model = await VoxtralRealtimeForConditionalGeneration.from_pretrained(
      'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX',
      { dtype: { audio_encoder: 'q4f16', embed_tokens: 'q4f16', decoder_model_merged: 'q4f16' }, device: 'cpu' },
    )

    // Run streaming test on first fixture
    const tc = manifest[0]
    const { samples: rawSamples, sampleRate } = readWavAsFloat32(join(FIXTURES_DIR, tc.file))
    const samples = resampleTo16k(rawSamples, sampleRate)

    const hop = processor.feature_extractor.config.hop_length
    const nfft = processor.feature_extractor.config.n_fft
    const numSamplesFirst = processor.num_samples_first_audio_chunk
    const numSamplesPerChunk = processor.num_samples_per_audio_chunk
    const samplesPerTok = processor.audio_length_per_tok * hop
    const numMelFirst = processor.num_mel_frames_first_audio_chunk
    const winHalf = Math.floor(nfft / 2)

    // Simulate streaming: feed audio in 1-second chunks
    const chunkSize = SAMPLE_RATE * CHUNK_DURATION_S
    let audioBuffer = new Float32Array(0)
    let audioResolve: (() => void) | null = null

    function appendChunk(chunk: Float32Array) {
      const merged = new Float32Array(audioBuffer.length + chunk.length)
      merged.set(audioBuffer)
      merged.set(chunk, audioBuffer.length)
      audioBuffer = merged
      if (audioResolve) { audioResolve(); audioResolve = null }
    }

    function waitForAudio(): Promise<void> {
      return new Promise((r) => { audioResolve = r })
    }

    // Metrics
    const startTime = Date.now()
    let firstTokenTime: number | null = null
    let allText = ''
    let tokenCount = 0

    // Start feeding audio chunks with simulated real-time delay
    const feedPromise = (async () => {
      for (let offset = 0; offset < samples.length; offset += chunkSize) {
        const chunk = samples.subarray(offset, Math.min(offset + chunkSize, samples.length))
        appendChunk(chunk)
        // Simulate real-time: wait proportional to chunk duration (but faster for test)
        await new Promise((r) => setTimeout(r, 50)) // 50ms per 1s chunk (20x faster)
      }
    })()

    // Build streaming pipeline
    const firstChunkReady = new Promise<void>((resolve) => {
      const check = () => {
        if (audioBuffer.length >= numSamplesFirst) resolve()
        else setTimeout(check, 10)
      }
      check()
    })
    await firstChunkReady

    const firstChunkInputs = await processor(audioBuffer.subarray(0, numSamplesFirst), {
      is_streaming: true, is_first_audio_chunk: true,
    })

    let audioConsumed = numSamplesFirst

    async function* featureGen() {
      yield firstChunkInputs.input_features

      const endTime = Date.now() + 30000 // 30s max
      while (Date.now() < endTime) {
        const needed = audioConsumed + numSamplesPerChunk
        while (audioBuffer.length < needed) {
          if (audioBuffer.length >= samples.length) return // all audio consumed
          await waitForAudio()
        }

        let batchEnd = Math.min(needed, audioBuffer.length)
        while (batchEnd + samplesPerTok <= audioBuffer.length) batchEnd += samplesPerTok

        let chunkAudio = audioBuffer.slice(audioConsumed, batchEnd)
        const rawMel = Math.floor((chunkAudio.length - nfft) / hop)
        const rem = rawMel % 8
        if (rem !== 0) {
          const padded = new Float32Array(chunkAudio.length + (8 - rem) * hop)
          padded.set(chunkAudio)
          chunkAudio = padded
        }

        const chunkInputs = await processor(chunkAudio, { is_streaming: true, is_first_audio_chunk: false })
        yield chunkInputs.input_features
        audioConsumed = batchEnd
      }
    }

    // Streamer to capture tokens
    const tokenizer = processor.tokenizer
    const specialIds = new Set(tokenizer.all_special_ids.map(BigInt))
    let tokenCache: bigint[] = []
    let printLen = 0
    let isPrompt = true

    const streamer = new (class extends BaseStreamer {
      put(value: bigint[][]) {
        if (isPrompt) { isPrompt = false; return }
        const tokens = value[0]
        if (tokens.length === 1 && specialIds.has(tokens[0])) return
        tokenCache = tokenCache.concat(tokens)
        const text = tokenizer.decode(tokenCache, { skip_special_tokens: true })
        const newText = text.slice(printLen)
        printLen = text.length
        if (newText.length > 0) {
          if (firstTokenTime === null) firstTokenTime = Date.now()
          allText += newText
          tokenCount++
        }
      }
      end() {
        if (tokenCache.length > 0) {
          const text = tokenizer.decode(tokenCache, { skip_special_tokens: true })
          const remaining = text.slice(printLen)
          if (remaining) allText += remaining
        }
      }
    })()

    await model.generate({
      input_ids: firstChunkInputs.input_ids,
      input_features: featureGen(),
      max_new_tokens: 4096,
      temperature: 0.0,
      do_sample: false,
      streamer,
    })

    await feedPromise
    const endTime = Date.now()

    // Calculate metrics
    const ttft = firstTokenTime ? firstTokenTime - startTime : -1
    const totalTime = endTime - startTime
    const audioDuration = samples.length / SAMPLE_RATE * 1000
    const overlap = wordOverlapRatio(tc.expected, allText.trim())

    console.log(`\n[streaming-test] ${tc.file} (${tc.language})`)
    console.log(`  Audio duration: ${(audioDuration / 1000).toFixed(1)}s`)
    console.log(`  Time to first token (TTFT): ${ttft}ms`)
    console.log(`  Total processing time: ${totalTime}ms`)
    console.log(`  Real-time factor: ${(totalTime / audioDuration).toFixed(2)}x`)
    console.log(`  Tokens produced: ${tokenCount}`)
    console.log(`  Word overlap: ${Math.round(overlap * 100)}%`)
    console.log(`  Expected: "${tc.expected.slice(0, 80)}..."`)
    console.log(`  Got:      "${allText.trim().slice(0, 80)}..."`)

    // Assertions
    expect(overlap).toBeGreaterThanOrEqual(tc.minOverlap ?? 0.5)
    expect(ttft).toBeGreaterThan(0) // must produce at least one token
    expect(ttft).toBeLessThan(30000) // first token within 30s
  })
})
