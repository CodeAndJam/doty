/**
 * The log-mel frontend EmbeddingGemma 2's audio encoder was trained on.
 *
 * Every number below comes from `preprocessor_config.json` in
 * `onnx-community/embeddinggemma-2-ONNX` (`feature_extractor_type:
 * "Gemma4AudioFeatureExtractor"`), which is the same export as the ONNX graphs on
 * disk. Guessing any of these yields vectors that look plausible and mean
 * nothing, so they are a contract: change the model, change this object.
 *
 * What the graph expects is `[1, frames, 128]` plus `[1, frames]` mask. The
 * framing is unusual in two ways, both copied from `feature_extraction_gemma4.js`
 * in transformers.js v4.3.2 rather than assumed:
 *
 *   - padding is *semicausal*: half a window of zeros on the left, none on the
 *     right, so frame i covers `[i*hop - 160, i*hop + 160)`;
 *   - the last frame is only kept when all of its samples are real audio, which
 *     is what the mask is for.
 */

export interface MelContract {
  sampleRate: number
  fftLength: number
  /** Window width in samples: 20 ms. */
  frameLength: number
  /** 10 ms. */
  hopLength: number
  bins: number
  minFrequency: number
  maxFrequency: number
  /** Added to the mel energies *before* the log, not clamped. */
  melFloor: number
  /** The encoder's conv stack assumes a sample count that is a multiple of this. */
  padToMultipleOf: number
}

/**
 * Source: `onnx-community/embeddinggemma-2-ONNX/preprocessor_config.json`
 * (fetched 2026-11-15, 1 KB), checked against the extractor that produces the
 * numbers the audio graph was exported to consume.
 */
export const GEMMA4_MEL: MelContract = {
  sampleRate: 16000,
  fftLength: 512,
  frameLength: 320,
  hopLength: 160,
  bins: 128,
  minFrequency: 0,
  maxFrequency: 8000,
  melFloor: 0.001,
  padToMultipleOf: 128,
}

export interface MelSpectrogram {
  /** `frames * bins`, row-major by frame. Invalid frames are left at zero. */
  data: Float32Array
  frames: number
  bins: number
  /** 1 where the frame is entirely real audio, 0 where it is padding. */
  mask: Uint8Array
}

/**
 * How many audio tokens the encoder emits for this mask. Its two stride-2
 * convolutions keep one frame in four; the fused graph needs exactly one
 * `<|audio|>` placeholder per kept frame.
 */
export function audioTokenCount(mask: Uint8Array): number {
  let count = 0
  for (let i = 0; i < mask.length; i += 4) count += mask[i]
  return count
}

/**
 * HTK mel triangles over a magnitude spectrogram: the extractor's defaults are
 * `norm: null, mel_scale: 'htk', triangularize_in_mel_space: false`.
 */
export function melFilterBank(c: MelContract = GEMMA4_MEL): Float32Array[] {
  const binCount = Math.floor(c.fftLength / 2) + 1
  const toMel = (hz: number) => 2595 * Math.log10(1 + hz / 700)
  const toHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1)

  const low = toMel(c.minFrequency)
  const high = toMel(c.maxFrequency)
  const centres = Array.from({ length: c.bins + 2 }, (_, i) => toHz(low + ((high - low) * i) / (c.bins + 1)))
  const freqs = Array.from({ length: binCount }, (_, i) => (i * Math.floor(c.sampleRate / 2)) / (binCount - 1))

  return Array.from({ length: c.bins }, (_, filter) => {
    const row = new Float32Array(binCount)
    const left = centres[filter]
    const middle = centres[filter + 1]
    const right = centres[filter + 2]
    for (let bin = 0; bin < binCount; bin++) {
      const up = (freqs[bin] - left) / (middle - left)
      const down = (right - freqs[bin]) / (right - middle)
      row[bin] = Math.max(0, Math.min(up, down))
    }
    return row
  })
}

/** Periodic Hann of `frameLength`, matching numpy's `hanning(frameLength + 1)[:-1]`. */
function hann(length: number): Float32Array {
  const window = new Float32Array(length)
  for (let i = 0; i < length; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length)
  return window
}

/** In-place iterative radix-2 FFT of a power-of-two length. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const angle = step * k
        const wr = Math.cos(angle)
        const wi = Math.sin(angle)
        const a = start + k
        const b = a + size / 2
        const xr = re[b] * wr - im[b] * wi
        const xi = re[b] * wi + im[b] * wr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
}

/**
 * One frame: window it, transform it, project the magnitudes onto the mel
 * triangles, take the log. `out` is `bins` long and overwritten.
 */
function frameLogMel(
  pcm: Float32Array,
  frame: number,
  c: MelContract,
  window: Float32Array,
  filters: Float32Array[],
  re: Float64Array,
  im: Float64Array,
  out: Float32Array,
): void {
  const offset = frame * c.hopLength - Math.floor(c.frameLength / 2)
  re.fill(0)
  im.fill(0)
  for (let i = 0; i < c.frameLength; i++) {
    const sample = offset + i
    if (sample >= 0 && sample < pcm.length) re[i] = pcm[sample] * window[i]
  }
  fft(re, im)
  out.fill(0)
  const binCount = Math.floor(c.fftLength / 2) + 1
  for (let bin = 0; bin < binCount; bin++) {
    const magnitude = Math.hypot(re[bin], im[bin])
    for (let filter = 0; filter < c.bins; filter++) out[filter] += magnitude * filters[filter][bin]
  }
  for (let filter = 0; filter < c.bins; filter++) out[filter] = Math.log(out[filter] + c.melFloor)
}

/**
 * PCM (mono, 16 kHz, -1..1) to log-mel features. Deterministic and synchronous:
 * a 30 s clip is ~50 ms of work, which is cheap next to the encoder pass.
 */
export function logMelSpectrogram(pcm: Float32Array, c: MelContract = GEMMA4_MEL): MelSpectrogram {
  const padLeft = Math.floor(c.frameLength / 2)
  const length = c.padToMultipleOf > 1 ? Math.ceil(pcm.length / c.padToMultipleOf) * c.padToMultipleOf : pcm.length
  // The extractor's unfold(frame_length + 1) framing: one sample more than a window.
  const frames = Math.max(0, Math.floor((length + padLeft - (c.frameLength + 1)) / c.hopLength) + 1)
  const filters = melFilterBank(c)
  const window = hann(c.frameLength)
  const re = new Float64Array(c.fftLength)
  const im = new Float64Array(c.fftLength)
  const data = new Float32Array(frames * c.bins)
  const mask = new Uint8Array(frames)
  const frameOut = new Float32Array(c.bins)

  for (let frame = 0; frame < frames; frame++) {
    // A frame is real audio only when the last sample it reads is real audio.
    if (frame * c.hopLength + c.frameLength >= padLeft + pcm.length) break
    mask[frame] = 1
    frameLogMel(pcm, frame, c, window, filters, re, im, frameOut)
    data.set(frameOut, frame * c.bins)
  }

  return { data, frames, bins: c.bins, mask }
}
