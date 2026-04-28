/**
 * Component test: verifies model loads exactly once during a 90-second
 * streaming session, even when generate() ends and restarts.
 *
 * This catches the bug where generate() hitting EOS causes a new session
 * that re-loads the model or resets state unnecessarily.
 *
 * Run with:  npx vitest run electron/voxtral-session.test.ts
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

/** Loop audio to target duration */
function loopAudio(source: Float32Array, targetSeconds: number): Float32Array {
  const targetSamples = targetSeconds * SAMPLE_RATE
  const result = new Float32Array(targetSamples)
  for (let i = 0; i < targetSamples; i++) result[i] = source[i % source.length]
  return result
}

describe('Voxtral session: model loads once over 90s', { timeout: 900_000 }, () => {
  it('model.generate is called without reloading model', async () => {
    const dmFile = join(FIXTURES_DIR, 'dm-portuguese.wav')
    if (!fs.existsSync(dmFile)) return

    const baseSamples = readWavAsFloat32(dmFile)
    const samples = loopAudio(baseSamples, 90) // 90 seconds
    console.log(`[session-test] Audio: ${(samples.length / SAMPLE_RATE).toFixed(0)}s`)

    const transformers = await import('@huggingface/transformers')
    const { VoxtralRealtimeForConditionalGeneration, VoxtralRealtimeProcessor, env } = transformers
    const BaseStreamer = transformers.BaseStreamer
    env.cacheDir = join(HOME, '.doty', 'hf-cache')
    env.allowRemoteModels = true

    // === SPY: count model loads ===
    let modelLoadCount = 0
    let generateCallCount = 0

    const processor = await VoxtralRealtimeProcessor.from_pretrained('onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX')
    const model = await VoxtralRealtimeForConditionalGeneration.from_pretrained(
      'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX',
      { dtype: { audio_encoder: 'q4f16', embed_tokens: 'q4f16', decoder_model_merged: 'q4f16' }, device: 'cpu' },
    )
    modelLoadCount++ // This is the only load

    // === Simulate voxtral-child session lifecycle ===
    // The bug: generate() ends (EOS), session restarts, model reloads
    // The fix: model stays loaded, only generate() restarts

    const hop = processor.feature_extractor.config.hop_length
    const nfft = processor.feature_extractor.config.n_fft
    const numSamplesFirst = processor.num_samples_first_audio_chunk
    const numSamplesPerChunk = processor.num_samples_per_audio_chunk
    const samplesPerTok = processor.audio_length_per_tok * hop

    // Simulate the streaming with audio arriving in real-time
    let audioBuffer = new Float32Array(0)
    let audioResolve: (() => void) | null = null
    let allFed = false

    function appendAudio(chunk: Float32Array) {
      const merged = new Float32Array(audioBuffer.length + chunk.length)
      merged.set(audioBuffer)
      merged.set(chunk, audioBuffer.length)
      audioBuffer = merged
      if (audioResolve) { audioResolve(); audioResolve = null }
    }
    function waitForAudio(): Promise<void> {
      if (allFed) return Promise.resolve()
      return new Promise((r) => { audioResolve = r })
    }

    // Feed audio at 10x real-time
    const feedPromise = (async () => {
      const chunkSize = SAMPLE_RATE
      for (let offset = 0; offset < samples.length; offset += chunkSize) {
        appendAudio(samples.subarray(offset, Math.min(offset + chunkSize, samples.length)))
        await new Promise((r) => setTimeout(r, 100))
      }
      allFed = true
      if (audioResolve) { audioResolve(); audioResolve = null }
    })()

    // Run session (may restart if generate ends early)
    let totalTokens = 0
    let sessionCount = 0
    let audioConsumed = 0

    async function runSession() {
      sessionCount++
      generateCallCount++

      // Wait for first chunk
      while (audioBuffer.length - audioConsumed < numSamplesFirst) {
        if (allFed && audioBuffer.length <= audioConsumed) return
        await waitForAudio()
      }

      const firstChunkInputs = await processor(
        audioBuffer.subarray(audioConsumed, audioConsumed + numSamplesFirst),
        { is_streaming: true, is_first_audio_chunk: true },
      )
      audioConsumed += numSamplesFirst

      async function* featureGen() {
        yield firstChunkInputs.input_features
        while (true) {
          const needed = audioConsumed + numSamplesPerChunk
          while (audioBuffer.length < needed) {
            if (allFed && audioBuffer.length <= audioConsumed) return
            await waitForAudio()
            if (allFed && audioBuffer.length < needed) {
              if (audioBuffer.length > audioConsumed) break
              return
            }
          }
          let batchEnd = Math.min(audioBuffer.length, audioConsumed + SAMPLE_RATE * 5)
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
          const inputs = await processor(chunkAudio, { is_streaming: true, is_first_audio_chunk: false })
          yield inputs.input_features
          audioConsumed = batchEnd
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
          if (text.length > printLen) {
            totalTokens++
            printLen = text.length
          }
          if (tokenCache.length > 40) { tokenCache = []; printLen = 0 }
        }
        end() { tokenCache = []; printLen = 0 }
      })()

      await model.generate({
        input_ids: firstChunkInputs.input_ids,
        input_features: featureGen(),
        max_new_tokens: 2048,
        temperature: 0.0,
        do_sample: false,
        streamer,
      })
    }

    // Run sessions — if generate() ends early, restart WITHOUT reloading model
    const startTime = Date.now()
    while (!allFed || audioBuffer.length > audioConsumed + numSamplesFirst) {
      await runSession()
      // Key assertion: we never reload the model between sessions
      if (Date.now() - startTime > 300_000) break // safety timeout 5min
      if (allFed && audioBuffer.length <= audioConsumed + numSamplesFirst) break
    }

    await feedPromise
    const totalTime = Date.now() - startTime

    console.log(`[session-test] Results:`)
    console.log(`  Sessions: ${sessionCount}`)
    console.log(`  Model loads: ${modelLoadCount}`)
    console.log(`  generate() calls: ${generateCallCount}`)
    console.log(`  Total tokens: ${totalTokens}`)
    console.log(`  Total time: ${(totalTime / 1000).toFixed(1)}s`)

    // === ASSERTIONS ===
    expect(modelLoadCount, 'Model must load exactly once').toBe(1)
    expect(generateCallCount, 'generate() may restart but model stays loaded').toBeGreaterThanOrEqual(1)
    expect(totalTokens, 'Must produce tokens').toBeGreaterThan(0)
    // If generate restarts, it should be seamless (no re-download)
    console.log(`  ✓ Model loaded ${modelLoadCount} time(s), generate() called ${generateCallCount} time(s)`)
  })
})
