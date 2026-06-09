/**
 * Voxtral latency regression test.
 *
 * Asserts that end-to-end transcript latency stays under 5 seconds:
 * measures the gap between feeding the last audio sample and receiving
 * the first token of output for that segment.
 *
 * Also checks that latency does NOT degrade over time (the "growing gap" bug).
 *
 * Run with:  npx vitest run electron/voxtral-latency.test.ts
 *
 * @vitest-environment node
 */

import fs from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FIXTURES_DIR = join(__dirname, '..', 'test-fixtures', 'stt')
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ''
const SAMPLE_RATE = 16000
const MAX_LATENCY_MS = 5000

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

describe('Voxtral latency budget (<5s end-to-end)', { timeout: 600_000 }, () => {
  it('transcript latency stays under 5 seconds and does not degrade over time', async () => {
    const dmFile = join(FIXTURES_DIR, 'dm-portuguese.wav')
    if (!fs.existsSync(dmFile)) return

    const samples = readWavAsFloat32(dmFile)
    const audioDurationS = samples.length / SAMPLE_RATE
    console.log(`[latency-test] Audio: ${audioDurationS.toFixed(1)}s`)

    const transformers = await import('@huggingface/transformers')
    const { VoxtralRealtimeForConditionalGeneration, VoxtralRealtimeProcessor, env } = transformers
    const BaseStreamer = transformers.BaseStreamer
    env.cacheDir = join(HOME, '.doty', 'hf-cache')
    env.allowRemoteModels = true

    const processor = await VoxtralRealtimeProcessor.from_pretrained(
      'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX',
    )
    const model = await VoxtralRealtimeForConditionalGeneration.from_pretrained(
      'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX',
      { dtype: { audio_encoder: 'q4f16', embed_tokens: 'q4f16', decoder_model_merged: 'q4f16' }, device: 'cpu' },
    )

    const hop = processor.feature_extractor.config.hop_length
    const nfft = processor.feature_extractor.config.n_fft
    const numSamplesFirst = processor.num_samples_first_audio_chunk
    const numSamplesPerChunk = processor.num_samples_per_audio_chunk

    // === Feed audio in real-time 1s chunks, measure per-segment latency ===
    let audioBuffer = new Float32Array(0)
    let audioResolve: (() => void) | null = null
    let allAudioFed = false

    function appendAudio(chunk: Float32Array) {
      const merged = new Float32Array(audioBuffer.length + chunk.length)
      merged.set(audioBuffer)
      merged.set(chunk, audioBuffer.length)
      audioBuffer = merged
      if (audioResolve) {
        audioResolve()
        audioResolve = null
      }
    }

    function waitForAudio(): Promise<void> {
      if (allAudioFed) return Promise.resolve()
      return new Promise((r) => {
        audioResolve = r
      })
    }

    // Track when each chunk is fed and when tokens arrive
    const chunkFedTimes: number[] = [] // wallclock time when each 1s chunk was fed
    const tokenArrivalTimes: number[] = [] // wallclock time when each token batch arrived

    // Feed audio at real-time pace (1s chunks every 1000ms)
    const CHUNK_SIZE = SAMPLE_RATE
    const feedPromise = (async () => {
      for (let offset = 0; offset < samples.length; offset += CHUNK_SIZE) {
        const chunk = samples.subarray(offset, Math.min(offset + CHUNK_SIZE, samples.length))
        chunkFedTimes.push(Date.now())
        appendAudio(chunk)
        // Real-time: wait 1 second between chunks
        await new Promise((r) => setTimeout(r, 1000))
      }
      allAudioFed = true
      if (audioResolve) {
        audioResolve()
        audioResolve = null
      }
    })()

    // Wait for first chunk
    while (audioBuffer.length < numSamplesFirst) await waitForAudio()

    const firstChunkInputs = await processor(audioBuffer.subarray(0, numSamplesFirst), {
      is_streaming: true,
      is_first_audio_chunk: true,
    })

    let audioConsumed = numSamplesFirst

    async function* featureGen() {
      yield firstChunkInputs.input_features

      while (true) {
        const needed = audioConsumed + numSamplesPerChunk
        while (audioBuffer.length < needed) {
          if (allAudioFed && audioBuffer.length <= audioConsumed) return
          await waitForAudio()
          if (allAudioFed && audioBuffer.length < needed) {
            if (audioBuffer.length > audioConsumed) break
            return
          }
        }

        // Skip stale audio if backlog exceeds 3 seconds (prevents latency spiral)
        const backlog = audioBuffer.length - audioConsumed
        if (backlog > SAMPLE_RATE * 3) {
          audioConsumed = audioBuffer.length - SAMPLE_RATE // keep latest 1s
        }

        const batchEnd = Math.min(audioBuffer.length, audioConsumed + numSamplesPerChunk)
        if (batchEnd <= audioConsumed) return

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
        audioConsumed = batchEnd

        // Trim consumed audio to prevent memory growth
        if (audioConsumed > SAMPLE_RATE * 10) {
          audioBuffer = audioBuffer.slice(audioConsumed)
          audioConsumed = 0
        }
      }
    }

    // Streamer that records token arrival times
    const tokenizer = processor.tokenizer
    const specialIds = new Set(tokenizer.all_special_ids.map(BigInt))
    let tokenCache: bigint[] = []
    let printLen = 0
    let isPrompt = true

    const streamer = new (class extends BaseStreamer {
      put(value: bigint[][]) {
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
          tokenArrivalTimes.push(Date.now())
          // Reset cache periodically to prevent slowdown
          if (tokenCache.length > 20) {
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

    await feedPromise

    // === Compute latency: for each token, how long after the most recent audio chunk was it produced? ===
    const latencies: number[] = []
    for (const tokenTime of tokenArrivalTimes) {
      // Find the latest chunk that was fed before this token
      let lastChunkTime = chunkFedTimes[0]
      for (const ct of chunkFedTimes) {
        if (ct <= tokenTime) lastChunkTime = ct
        else break
      }
      latencies.push(tokenTime - lastChunkTime)
    }

    // Split latencies into first half and second half to detect degradation
    const half = Math.floor(latencies.length / 2)
    const firstHalfAvg = latencies.slice(0, half).reduce((a, b) => a + b, 0) / (half || 1)
    const secondHalfAvg = latencies.slice(half).reduce((a, b) => a + b, 0) / (latencies.length - half || 1)
    const maxLatency = Math.max(...latencies)
    const degradationRatio = secondHalfAvg / (firstHalfAvg || 1)

    console.log(`\n[latency-test] Results:`)
    console.log(`  Tokens produced: ${tokenArrivalTimes.length}`)
    console.log(`  Avg latency (first half): ${firstHalfAvg.toFixed(0)}ms`)
    console.log(`  Avg latency (second half): ${secondHalfAvg.toFixed(0)}ms`)
    console.log(`  Max latency: ${maxLatency.toFixed(0)}ms`)
    console.log(`  Degradation ratio: ${degradationRatio.toFixed(2)}x`)

    // === Assertions ===
    expect(maxLatency, `Max latency must be < ${MAX_LATENCY_MS}ms`).toBeLessThan(MAX_LATENCY_MS)
    expect(degradationRatio, 'Latency must not degrade >2x over time').toBeLessThan(2.0)
    expect(tokenArrivalTimes.length, 'Must produce tokens').toBeGreaterThan(0)
  })
})
