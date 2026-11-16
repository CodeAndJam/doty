/**
 * The log-mel frontend, against its contract: frame count, mask and the shape the
 * audio encoder's ONNX graph declares. The values themselves are checked against
 * the transformers.js feature extractor in `embedder.test.ts`, where the model is
 * installed anyway; these tests run everywhere.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { audioTokenCount, GEMMA4_MEL, logMelSpectrogram, melFilterBank } from './mel'

const tone = (seconds: number, hz = 440, rate = 16000) => {
  const pcm = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin((2 * Math.PI * hz * i) / rate) * 0.5
  return pcm
}

describe('mel contract', () => {
  it('is the extractor config the audio graph was exported with', () => {
    expect(GEMMA4_MEL).toMatchObject({
      sampleRate: 16000,
      fftLength: 512,
      frameLength: 320,
      hopLength: 160,
      bins: 128,
      maxFrequency: 8000,
    })
  })

  it('builds 128 non-negative triangles over 257 FFT bins', () => {
    const filters = melFilterBank()
    expect(filters).toHaveLength(128)
    let emptyRows = 0
    for (const row of filters) {
      expect(row).toHaveLength(257)
      expect(Math.max(...row)).toBeLessThanOrEqual(1.0001)
      expect(Math.min(...row)).toBeGreaterThanOrEqual(0)
      if (Math.max(...row) === 0) emptyRows++
    }
    // A triangle narrower than the 31.25 Hz bin spacing can fall between bins;
    // the extractor leaves those empty too (and this is why the encoder is not
    // fed a filter bank we made up).
    expect(emptyRows).toBeLessThan(10)
  })
})

describe('logMelSpectrogram', () => {
  it('frames a one-second clip with semicausal padding', () => {
    const mel = logMelSpectrogram(tone(1))
    // 16000 samples, no padding needed: floor((16000 + 160 - 321) / 160) + 1
    expect(mel.frames).toBe(99)
    expect(mel.bins).toBe(128)
    expect(mel.data).toHaveLength(99 * 128)
    expect(Array.from(mel.mask)).toEqual(Array(99).fill(1))
  })

  it('pads the sample count to a multiple of 128 before framing', () => {
    const mel = logMelSpectrogram(tone(1).subarray(0, 1000))
    expect(mel.frames).toBe(6)
    expect(mel.mask).toHaveLength(6)
  })

  it('leaves a clip shorter than one window with no frames', () => {
    const mel = logMelSpectrogram(new Float32Array(100))
    expect(mel.frames).toBe(0)
    expect(mel.data).toHaveLength(0)
    expect(mel.mask).toHaveLength(0)
  })

  it('puts silence at the log floor, not at minus infinity', () => {
    const mel = logMelSpectrogram(new Float32Array(16000))
    expect(mel.data[0]).toBeCloseTo(Math.log(GEMMA4_MEL.melFloor), 5)
    for (const value of mel.data) expect(Number.isFinite(value)).toBe(true)
  })

  it('puts a 440 Hz tone in the low mel bands, not the high ones', () => {
    const mel = logMelSpectrogram(tone(1))
    const mean = new Float64Array(128)
    for (let frame = 0; frame < mel.frames; frame++) {
      for (let bin = 0; bin < 128; bin++) mean[bin] += mel.data[frame * 128 + bin] / mel.frames
    }
    let peak = 0
    for (let bin = 1; bin < 128; bin++) if (mean[bin] > mean[peak]) peak = bin
    // HTK mel of 440 Hz over 0–8 kHz lands around band 25.
    expect(peak).toBeGreaterThan(15)
    expect(peak).toBeLessThan(35)
  })
})

describe('audioTokenCount', () => {
  it('counts one token per four frames', () => {
    expect(audioTokenCount(new Uint8Array(0))).toBe(0)
    expect(audioTokenCount(new Uint8Array([1, 1, 1, 1]))).toBe(1)
    expect(audioTokenCount(new Uint8Array([1, 1, 1, 1, 1]))).toBe(2)
    expect(audioTokenCount(new Uint8Array(2999).fill(1))).toBe(750)
  })

  it('ignores padding frames', () => {
    expect(audioTokenCount(new Uint8Array([1, 0, 0, 0, 1, 1, 1, 0]))).toBe(2)
    expect(audioTokenCount(new Uint8Array([0, 1, 1, 1]))).toBe(0)
  })
})
