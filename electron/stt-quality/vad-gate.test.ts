import { describe, expect, it } from 'vitest'
import { SpeechGate } from './vad-gate'

const FRAME = 512
// 3 s at 16 kHz: enough for several frames and a couple of segments.
const SAMPLES = 16000 * 3

/** Silence is not silent in a room; the gate only looks at the probabilities. */
function audio(length = SAMPLES, amplitude = 0.1): Float32Array {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = Math.sin(i / 7) * amplitude
  return out
}

function frames(count: number, prob: number): number[] {
  return Array.from({ length: count }, () => prob)
}

/** Push `prob` for `frameCount` frames and return everything the gate emitted. */
function run(gate: SpeechGate, prob: number, frameCount: number): { chunks: Float32Array[]; closed: boolean } {
  const pcm = audio(frameCount * FRAME)
  gate.push(pcm, frames(frameCount, prob))
  return gate.drain()
}

const framesFor = (ms: number) => Math.round((ms * 16000) / 1000 / FRAME)

describe('SpeechGate', () => {
  it('never emits audio the VAD scores as non-speech', () => {
    const gate = new SpeechGate({ emitSamples: 0 })
    // 3 s of music-level audio: loud, but every frame below the threshold.
    const { chunks, closed } = run(gate, 0.02, Math.ceil(SAMPLES / FRAME))
    expect(chunks).toEqual([])
    expect(closed).toBe(false)
  })

  it('opens a segment only after the speech run is long enough', () => {
    const gate = new SpeechGate({ minSpeechMs: 250, emitSamples: 16000 * 0.16 })
    // 6 frames = 192 ms of speech: a click, not a word.
    expect(run(gate, 0.9, 6).chunks).toEqual([])
    expect(gate.inSpeech).toBe(false)

    // A further 4 frames carries the run past 250 ms: the whole run is emitted
    // (onset included, so the first word is not clipped).
    const { chunks } = run(gate, 0.9, 4)
    expect(gate.inSpeech).toBe(true)
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBe(10 * FRAME)
  })

  it('keeps a short gap inside a phrase and closes on a long one', () => {
    const gate = new SpeechGate({ minSpeechMs: 250, minSilenceMs: 300, emitSamples: 0 })
    run(gate, 0.9, framesFor(500))
    expect(gate.inSpeech).toBe(true)

    // 224 ms of silence: a breath between words, kept with the phrase.
    const breath = run(gate, 0.05, framesFor(224))
    expect(breath.chunks).toEqual([])
    expect(gate.inSpeech).toBe(true)

    // 320 ms of silence: the phrase is over, the segment is emitted.
    const end = run(gate, 0.05, framesFor(320))
    expect(end.closed).toBe(true)
    expect(end.chunks).toHaveLength(1)
    expect(gate.inSpeech).toBe(false)
  })

  it('holds a segment open when the probability only dips', () => {
    const gate = new SpeechGate({ minSpeechMs: 250, emitSamples: 0 })
    run(gate, 0.9, framesFor(500))
    // 0.4 is below the open threshold but above the hold threshold.
    expect(run(gate, 0.4, framesFor(500)).closed).toBe(false)
    expect(gate.inSpeech).toBe(true)
  })

  it('caps a long monologue for batch decoders', () => {
    const gate = new SpeechGate({ maxSamples: 16000, emitSamples: 0 })
    const { chunks, closed } = run(gate, 0.9, framesFor(2200))
    expect(closed).toBe(false)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    for (const chunk of chunks) expect(chunk.length).toBeGreaterThanOrEqual(16000 - FRAME)
    expect(gate.inSpeech).toBe(true)
  })

  it('coalesces live audio into readable chunks', () => {
    const gate = new SpeechGate({ emitSamples: 16000 * 0.16 })
    const { chunks } = run(gate, 0.9, framesFor(1000))
    expect(chunks.length).toBeGreaterThan(1)
    // Every chunk is at least one emit size but never a huge backlog.
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThanOrEqual(16000 * 0.16)
      expect(chunk.length).toBeLessThan(16000 * 0.16 + FRAME * 2)
    }
  })

  it('scores the zero-padded tail frame of a flush', () => {
    const gate = new SpeechGate({ emitSamples: 0 })
    // 8000 samples = 15 full frames + 320 left over.
    gate.push(new Float32Array(8000), frames(15, 0.9))
    expect(gate.drain().chunks).toEqual([])
    // No further audio: the VAD scored the padded remainder, and the gate must
    // not wait for samples that will never arrive.
    gate.push(new Float32Array(0), frames(1, 0.9))
    expect(gate.drain().chunks).toEqual([])
    expect(gate.flush().chunks).toHaveLength(1)
  })

  it('flushes an open segment at session end', () => {
    const gate = new SpeechGate({ emitSamples: 0 })
    run(gate, 0.9, framesFor(500))
    const { chunks, closed } = gate.flush()
    expect(closed).toBe(true)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].length).toBe(framesFor(500) * FRAME)
  })

  it('survives audio arriving before its probabilities', () => {
    const gate = new SpeechGate({ minSpeechMs: 250, emitSamples: 16000 * 0.16 })
    // 500 ms of audio, but only the first 100 ms scored yet.
    const pcm = audio(8000)
    gate.push(pcm, frames(3, 0.9))
    // 6 more frames of probs arrive with the next chunk: the rest of the first
    // buffer is scored from what was already held.
    gate.push(new Float32Array(FRAME), frames(6, 0.9))
    expect(gate.inSpeech).toBe(true)
    expect(gate.drain().chunks.length).toBeGreaterThan(0)
  })

  it('emits only the speech part of a mixed clip', () => {
    const gate = new SpeechGate({ minSpeechMs: 250, minSilenceMs: 300, emitSamples: 0 })
    const probs = [...frames(framesFor(500), 0.02), ...frames(framesFor(1000), 0.99), ...frames(framesFor(1000), 0.02)]
    gate.push(audio(probs.length * FRAME), probs)
    const { chunks } = gate.drain()
    expect(chunks).toHaveLength(1)
    // Speech plus the 300 ms closing gap, not the music on either side.
    const expected = (framesFor(1000) + framesFor(300)) * FRAME
    expect(chunks[0].length).toBeGreaterThanOrEqual(expected - FRAME)
    expect(chunks[0].length).toBeLessThan(framesFor(2000) * FRAME)
  })

  it('resets between sessions', () => {
    const gate = new SpeechGate({ emitSamples: 0 })
    run(gate, 0.9, framesFor(500))
    gate.reset()
    expect(gate.drain().chunks).toEqual([])
    expect(gate.inSpeech).toBe(false)
    expect(gate.flush().chunks).toEqual([])
  })
})
