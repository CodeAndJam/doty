import { describe, expect, it } from 'vitest'
import { capSamples, longEnough, RESAMPLE_ARGS, toSamples } from './utterance'

function s16le(...values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 2)
  values.forEach((v, i) => buf.writeInt16LE(v, i * 2))
  return buf
}

describe('toSamples', () => {
  it('reads mono s16le as floats between -1 and 1', () => {
    const samples = toSamples(s16le(0, 16384, -16384, -32768, 32767))
    expect(samples).toHaveLength(5)
    expect(samples[0]).toBe(0)
    expect(samples[1]).toBeCloseTo(0.5, 4)
    expect(samples[2]).toBeCloseTo(-0.5, 4)
    expect(samples[3]).toBe(-1)
    expect(samples[4]).toBeLessThan(1)
  })
})

describe('capSamples', () => {
  it('leaves a short utterance untouched', () => {
    const samples = new Float32Array(16000)
    expect(capSamples(samples)).toBe(samples)
  })

  it('truncates a monologue at the ceiling instead of buffering it whole', () => {
    const samples = new Float32Array(16000 * 90)
    expect(capSamples(samples, 30)).toHaveLength(16000 * 30)
  })
})

describe('longEnough', () => {
  it('drops a cough and keeps a word', () => {
    expect(longEnough(new Float32Array(1600))).toBe(false) // 100 ms
    expect(longEnough(new Float32Array(4800))).toBe(true) // 300 ms
  })
})

describe('RESAMPLE_ARGS', () => {
  it('takes Discord 48 kHz stereo in and gives 16 kHz mono out', () => {
    const inputStart = RESAMPLE_ARGS.indexOf('-i')
    const before = RESAMPLE_ARGS.slice(0, inputStart)
    const after = RESAMPLE_ARGS.slice(inputStart)
    expect(before.join(' ')).toContain('-f s16le -ar 48000 -ac 2')
    expect(after.join(' ')).toContain('-f s16le -ar 16000 -ac 1')
  })
})
