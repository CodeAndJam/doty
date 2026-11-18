/** Utterance assembly for the remote lane: decoded PCM in, decodable samples out. */

export const SAMPLE_RATE = 16000

/** An utterance kept whole past this is memory, not speech. */
export const MAX_UTTERANCE_SEC = 30
export const MAX_UTTERANCE_BYTES = MAX_UTTERANCE_SEC * SAMPLE_RATE * 2

/**
 * ffmpeg's resample for the remote lane: Discord's 48 kHz stereo Opus down to
 * the 16 kHz mono the recogniser and the session WAV expect.
 */
export const RESAMPLE_ARGS = [
  '-hide_banner',
  '-loglevel',
  'error',
  '-f',
  's16le',
  '-ar',
  '48000',
  '-ac',
  '2',
  '-i',
  'pipe:0',
  '-f',
  's16le',
  '-ar',
  '16000',
  '-ac',
  '1',
  'pipe:1',
]

/** mono s16le → floats in [-1, 1). */
export function toSamples(pcm: Buffer): Float32Array {
  const samples = new Float32Array(Math.floor(pcm.length / 2))
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768
  return samples
}

/** A monologue is memory, not speech: keep at most `maxSeconds` of it. */
export function capSamples(samples: Float32Array, maxSeconds = 30): Float32Array {
  const max = SAMPLE_RATE * maxSeconds
  return samples.length <= max ? samples : samples.slice(0, max)
}

/** Below this there is nothing to decode — a cough, a chair, a door. */
export function longEnough(samples: Float32Array, minSeconds = 0.2): boolean {
  return samples.length >= SAMPLE_RATE * minSeconds
}
