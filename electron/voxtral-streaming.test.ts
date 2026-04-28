/**
 * Streaming performance test: measures Voxtral stability over extended audio.
 *
 * Uses dm-portuguese.wav (47s) — long enough to catch memory leaks
 * and progressive slowdown without taking too long on CPU.
 *
 * Run with:  npx vitest run electron/voxtral-streaming.test.ts
 *
 * @vitest-environment node
 */

import fs from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FIXTURES_DIR = join(__dirname, '..', 'test-fixtures', 'stt')
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ''
const SAMPLE_RATE = 16000

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
        const so = dataStart + i * numChannels * bytesPerSample
        samples[i] = bitsPerSample === 16 ? buf.readInt16LE(so) / 32768.0 : buf.readFloatLE(so)
      }
      return { samples, sampleRate }
    }
    offset += 8 + chunkSize
    if (chunkSize % 2 !== 0) offset++
  }
  throw new Error(`No data chunk found`)
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
    out[i] = samples[lo] * (1 - (srcIdx - lo)) + samples[hi] * (srcIdx - lo)
  }
  return out
}

describe('Voxtral streaming performance', { timeout: 600_000 }, () => {
  it('no progressive slowdown or memory leak over 47s audio', async () => {
    const dmFile = join(FIXTURES_DIR, 'dm-portuguese.wav')
    if (!fs.existsSync(dmFile)) return

    const { samples: rawSamples, sampleRate } = readWavAsFloat32(dmFile)
    const samples = resampleTo16k(rawSamples, sampleRate)
    console.log(`[streaming-perf] Audio: ${(samples.length / SAMPLE_RATE).toFixed(1)}s`)

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

    // All audio available upfront (no async waiting needed)
    const firstChunkInputs = await processor(samples.subarray(0, numSamplesFirst), {
      is_streaming: true,
      is_first_audio_chunk: true,
    })

    const numMelFirst = processor.num_mel_frames_first_audio_chunk
    let audioConsumed = numSamplesFirst
    const chunkTimes: number[] = []
    const memBefore = process.memoryUsage().heapUsed

    async function* featureGen() {
      yield firstChunkInputs.input_features

      while (audioConsumed < samples.length) {
        const needed = audioConsumed + numSamplesPerChunk
        if (needed > samples.length) return // no more audio

        // Limit each chunk to ~5 seconds max to get multiple measurements
        const maxChunkSamples = SAMPLE_RATE * 5
        let batchEnd = Math.min(needed, samples.length, audioConsumed + maxChunkSamples)
        if (batchEnd <= audioConsumed) return

        const t0 = Date.now()
        let chunkAudio = samples.slice(audioConsumed, batchEnd)
        const rawMel = Math.floor((chunkAudio.length - nfft) / hop)
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
      }
    }

    // Streamer with bounded tokenCache
    const tokenizer = processor.tokenizer
    const specialIds = new Set(tokenizer.all_special_ids.map(BigInt))
    let tokenCache: bigint[] = []
    let printLen = 0
    let isPrompt = true
    let tokenCount = 0
    let firstTokenTime: number | null = null
    const startTime = Date.now()

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
          tokenCount++
          // Bounded cache — reset after flush
          if (tokenCache.length > 40) {
            tokenCache = []
            printLen = 0
          }
        }
      }
      end() {}
    })()

    await model.generate({
      input_ids: firstChunkInputs.input_ids,
      input_features: featureGen(),
      max_new_tokens: 2048,
      temperature: 0.0,
      do_sample: false,
      streamer,
    })

    const totalTime = Date.now() - startTime
    const memAfter = process.memoryUsage().heapUsed
    const memGrowthMB = (memAfter - memBefore) / 1024 / 1024
    const ttft = firstTokenTime ? firstTokenTime - startTime : -1
    const audioDurationMs = (samples.length / SAMPLE_RATE) * 1000
    const rtf = totalTime / audioDurationMs

    // Slowdown check
    const half = Math.floor(chunkTimes.length / 2)
    const avgFirstHalf = chunkTimes.slice(0, half).reduce((a, b) => a + b, 0) / (half || 1)
    const avgSecondHalf = chunkTimes.slice(half).reduce((a, b) => a + b, 0) / (chunkTimes.length - half || 1)
    const slowdown = avgSecondHalf / (avgFirstHalf || 1)

    console.log(`[streaming-perf] Results:`)
    console.log(`  TTFT: ${ttft}ms`)
    console.log(`  Total: ${(totalTime / 1000).toFixed(1)}s | RTF: ${rtf.toFixed(2)}x`)
    console.log(`  Tokens: ${tokenCount} | Chunks: ${chunkTimes.length}`)
    console.log(`  Chunk time first half: ${avgFirstHalf.toFixed(0)}ms | second half: ${avgSecondHalf.toFixed(0)}ms`)
    console.log(`  Slowdown ratio: ${slowdown.toFixed(2)}x`)
    console.log(`  Memory growth: ${memGrowthMB.toFixed(1)}MB`)

    // Assertions
    expect(ttft, 'TTFT < 20s').toBeLessThan(20000)
    expect(rtf, 'RTF < 3.0x').toBeLessThan(3.0)
    expect(slowdown, 'No progressive slowdown (< 3x)').toBeLessThan(3.0)
    expect(memGrowthMB, 'Memory growth < 200MB').toBeLessThan(200)
    expect(tokenCount, 'Must produce tokens').toBeGreaterThan(0)
  })
})
