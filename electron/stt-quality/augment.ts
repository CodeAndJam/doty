/**
 * Deterministic audio augmentation for the STT gate, so noise robustness is
 * measured without needing a recorded conference-room session.
 *
 * `shortcut: synthetic noise + reverb only; replace with real far-field
 * recordings when available (docs/QUALITY.md).`
 */

/** Small seeded PRNG so every run degrades the audio identically. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function rmsOf(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / Math.max(1, samples.length))
}

/** Add uniform white noise at the given signal-to-noise ratio. */
export function addWhiteNoise(samples: Float32Array, snrDb: number, seed = 42): Float32Array {
  const random = mulberry32(seed)
  const noiseRms = rmsOf(samples) / 10 ** (snrDb / 20)
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    // Uniform [-1,1] has RMS 1/sqrt(3).
    out[i] = samples[i] + (random() * 2 - 1) * noiseRms * Math.sqrt(3)
  }
  return out
}

/** Convolve with a 300ms exponentially decaying impulse response (far-field smear). */
export function addReverb(samples: Float32Array, seed = 7): Float32Array {
  const length = 4800
  const random = mulberry32(seed)
  const impulse = new Float32Array(length)
  for (let i = 0; i < length; i++) impulse[i] = (random() * 2 - 1) * Math.exp(-i / 1200)

  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    let acc = 0
    const limit = Math.min(length, i + 1)
    for (let j = 0; j < limit; j++) acc += samples[i - j] * impulse[j]
    out[i] = acc
  }
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  const gain = peak > 0 ? 0.9 / peak : 1
  for (let i = 0; i < out.length; i++) out[i] *= gain
  return out
}
