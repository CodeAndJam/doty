/**
 * TRUE streaming test: audio arrives in real-time 1-second chunks
 * while generate() is running. Measures latency and stability
 * under realistic conditions.
 *
 * This matches the actual app flow:
 * - Audio chunks arrive via IPC every ~1 second
 * - The generator blocks until enough audio is available
 * - Tokens are emitted as they're produced
 *
 * Run with:  npx vitest run electron/voxtral-streaming-realtime.test.ts
 *
 * @vitest-environment node
 */

import fs from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FIXTURES_DIR = join(__dirname, '..', 'test-fixtures', 'stt')
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ''
const SAMPLE_RATE = 16000

function readWavAsFloat32(filePath: string): Float32Array {
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
      // Resample if needed
      if (sampleRate !== SAMPLE_RATE) {
        const ratio = sampleRate / SAMPLE_RATE
        const outLen = Math.floor(total / ratio)
        const out = new Float32Array(outLen)
        for (let i = 0; i < outLen; i++) {
          const srcIdx = i * ratio
          const lo = Math.floor(srcIdx)
          out[i] = samples[lo] * (1 - (srcIdx - lo)) + samples[Math.min(lo + 1, total - 1)] * (srcIdx - lo)
        }
        return out
      }
      return samples
    }
    offset += 8 + sz
    if (sz % 2 !== 0) offset++
  }
  throw new Error('No data chunk')
}

describe('Voxtral true streaming (real-time audio delivery)', { timeout: 600_000 }, () => {
  it('processes audio arriving in real-time chunks without degradation', async () => {
    const dmFile = join(FIXTURES_DIR, 'dm-portuguese.wav')
    if (!fs.existsSync(dmFile)) return

    const samples = readWavAsFloat32(dmFile)
    console.log(`[realtime-test] Audio: ${(samples.length / SAMPLE_RATE).toFixed(1)}s`)

    const transformers = await import('@huggingface/transformers')
    const { VoxtralRealtimeForConditionalGeneration, VoxtralRealtimeProcessor, env } = transformers
    const BaseStreamer = transformers.BaseStreamer
    env.cacheDir = join(HOME, '.doty', 'hf-cache')
    env.allowRemoteModels = true

    const processor = await VoxtralRealtimeProcessor.from_pretrained('onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX')
    const model = await VoxtralRealtimeForConditionalGeneration.from_pretrained(
      'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX',
      { dtype: { audio_encoder: 'q4f16', embed_tokens: 'q4f16', decoder_model_merged: 'q4f16' }, device: 'cpu' },
    )

    const hop = processor.feature_extractor.config.hop_length
    const nfft = processor.feature_extractor.config.n_fft
    const numSamplesFirst = processor.num_samples_first_audio_chunk
    const numSamplesPerChunk = processor.num_samples_per_audio_chunk
    const samplesPerTok = processor.audio_length_per_tok * hop

    // === Simulate the voxtral-child streaming architecture ===
    let audioBuffer = new Float32Array(0)
    let audioResolve: (() => void) | null = null
    let allAudioFed = false

    function appendAudio(chunk: Float32Array) {
      const merged = new Float32Array(audioBuffer.length + chunk.length)
      merged.set(audioBuffer)
      merged.set(chunk, audioBuffer.length)
      audioBuffer = merged
      if (audioResolve) { audioResolve(); audioResolve = null }
    }

    function waitForAudio(): Promise<void> {
      if (allAudioFed) return Promise.resolve()
      return new Promise((r) => { audioResolve = r })
    }

    // Metrics
    const startTime = Date.now()
    let firstTokenTime: number | null = null
    let tokenCount = 0
    let allText = ''
    const tokenTimestamps: number[] = []
    const memBefore = process.memoryUsage().heapUsed

    // Feed audio in 1-second chunks with 100ms delay (10x faster than real-time)
    const CHUNK_SIZE = SAMPLE_RATE // 1 second
    const FEED_DELAY = 100 // ms between chunks (simulates 10x speed)

    const feedPromise = (async () => {
      for (let offset = 0; offset < samples.length; offset += CHUNK_SIZE) {
        const chunk = samples.subarray(offset, Math.min(offset + CHUNK_SIZE, samples.length))
        appendAudio(chunk)
        await new Promise((r) => setTimeout(r, FEED_DELAY))
      }
      allAudioFed = true
      // Wake up generator if waiting
      if (audioResolve) { audioResolve(); audioResolve = null }
    })()

    // Wait for first chunk to be available
    while (audioBuffer.length < numSamplesFirst) await waitForAudio()

    const firstChunkInputs = await processor(audioBuffer.subarray(0, numSamplesFirst), {
      is_streaming: true,
      is_first_audio_chunk: true,
    })

    let audioConsumed = numSamplesFirst
    const chunkTimes: number[] = []

    async function* featureGen() {
      yield firstChunkInputs.input_features

      while (true) {
        const needed = audioConsumed + numSamplesPerChunk
        // Wait for audio or end
        while (audioBuffer.length < needed) {
          if (allAudioFed && audioBuffer.length <= audioConsumed) return
          await waitForAudio()
          if (allAudioFed && audioBuffer.length < needed) {
            // Feed remaining as final chunk if any
            if (audioBuffer.length > audioConsumed) break
            return
          }
        }

        let batchEnd = Math.min(audioBuffer.length, audioConsumed + SAMPLE_RATE * 5) // max 5s per chunk
        if (batchEnd <= audioConsumed) return

        const t0 = Date.now()
        let chunkAudio = audioBuffer.slice(audioConsumed, batchEnd)
        const rawMel = Math.floor((chunkAudio.length - nfft) / hop)
        if (rawMel <= 0) return
        const rem = rawMel % 8
        if (rem !== 0) {
          const padded = new Float32Array(chunkAudio.length + (8 - rem) * hop)
          padded.set(chunkAudio)
          chunkAudio = padded
        }

        const chunkInputs = await processor(chunkAudio, { is_streaming: true, is_first_audio_chunk: false })
        yield chunkInputs.input_features

        chunkTimes.push(Date.now() - t0)
        audioConsumed = batchEnd

        // Trim consumed audio (matching production code)
        if (audioConsumed > SAMPLE_RATE * 10) {
          audioBuffer = audioBuffer.slice(audioConsumed)
          audioConsumed = 0
        }
      }
    }

    // Streamer with bounded cache
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
          tokenTimestamps.push(Date.now() - startTime)
          if (tokenCache.length > 40) { tokenCache = []; printLen = 0 }
        }
      }
      end() {
        if (tokenCache.length > 0) {
          const text = tokenizer.decode(tokenCache, { skip_special_tokens: true })
          allText += text.slice(printLen)
        }
      }
    })()

    await model.generate({
      input_ids: firstChunkInputs.input_ids,
      input_features: featureGen(),
      max_new_tokens: 2048,
      temperature: 0.0,
      do_sample: false,
      streamer,
    })

    await feedPromise
    const totalTime = Date.now() - startTime
    const memAfter = process.memoryUsage().heapUsed
    const memGrowthMB = (memAfter - memBefore) / 1024 / 1024
    const ttft = firstTokenTime ? firstTokenTime - startTime : -1
    const audioDurationMs = (samples.length / SAMPLE_RATE) * 1000

    // Token rate stability: compare first half vs second half
    const halfIdx = Math.floor(tokenTimestamps.length / 2)
    const firstHalfTokens = tokenTimestamps.slice(0, halfIdx)
    const secondHalfTokens = tokenTimestamps.slice(halfIdx)
    const avgGapFirst = firstHalfTokens.length > 1
      ? (firstHalfTokens[firstHalfTokens.length - 1] - firstHalfTokens[0]) / firstHalfTokens.length
      : 0
    const avgGapSecond = secondHalfTokens.length > 1
      ? (secondHalfTokens[secondHalfTokens.length - 1] - secondHalfTokens[0]) / secondHalfTokens.length
      : 0
    const tokenSlowdown = avgGapSecond / (avgGapFirst || 1)

    // Chunk processing stability
    const chunkHalf = Math.floor(chunkTimes.length / 2)
    const avgChunkFirst = chunkTimes.slice(0, chunkHalf).reduce((a, b) => a + b, 0) / (chunkHalf || 1)
    const avgChunkSecond = chunkTimes.slice(chunkHalf).reduce((a, b) => a + b, 0) / (chunkTimes.length - chunkHalf || 1)
    const chunkSlowdown = avgChunkSecond / (avgChunkFirst || 1)

    console.log(`\n[realtime-test] Results:`)
    console.log(`  Audio: ${(audioDurationMs / 1000).toFixed(1)}s | Feed rate: ${FEED_DELAY}ms/chunk (${(1000 / FEED_DELAY).toFixed(0)}x realtime)`)
    console.log(`  TTFT: ${ttft}ms`)
    console.log(`  Total: ${(totalTime / 1000).toFixed(1)}s | RTF: ${(totalTime / audioDurationMs).toFixed(2)}x`)
    console.log(`  Tokens: ${tokenCount} | Chunks: ${chunkTimes.length}`)
    console.log(`  Token rate: first half ${avgGapFirst.toFixed(0)}ms/tok, second half ${avgGapSecond.toFixed(0)}ms/tok`)
    console.log(`  Token slowdown: ${tokenSlowdown.toFixed(2)}x`)
    console.log(`  Chunk time: first half ${avgChunkFirst.toFixed(0)}ms, second half ${avgChunkSecond.toFixed(0)}ms`)
    console.log(`  Chunk slowdown: ${chunkSlowdown.toFixed(2)}x`)
    console.log(`  Memory growth: ${memGrowthMB.toFixed(1)}MB`)
    console.log(`  Output: "${allText.trim().slice(0, 100)}..."`)

    // === Performance assertions ===
    expect(ttft, 'TTFT < 20s').toBeLessThan(20000)
    expect(totalTime / audioDurationMs, 'RTF < 3.0x').toBeLessThan(3.0)
    expect(tokenSlowdown, 'Token rate stable (< 3x slowdown)').toBeLessThan(3.0)
    expect(chunkSlowdown, 'Chunk processing stable (< 3x slowdown)').toBeLessThan(3.0)
    expect(memGrowthMB, 'Memory growth < 200MB').toBeLessThan(200)
    expect(tokenCount, 'Must produce tokens').toBeGreaterThan(0)
  })
})
