import { describe, expect, it } from 'vitest'
import { addReverb, addWhiteNoise } from './augment'

function sameContent(a: Float32Array, b: Float32Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

describe('addWhiteNoise', () => {
  it('is deterministic for a seed', () => {
    const dry = new Float32Array(16000).fill(0.1)
    expect(sameContent(addWhiteNoise(dry, 12, 42), addWhiteNoise(dry, 12, 42))).toBe(true)
    expect(sameContent(addWhiteNoise(dry, 12, 42), addWhiteNoise(dry, 12, 43))).toBe(false)
  })

  it('keeps the original signal and adds energy', () => {
    const dry = new Float32Array(48000).fill(0.1)
    const wet = addWhiteNoise(dry, 20)
    expect(wet.length).toBe(dry.length)
    let wetEnergy = 0
    for (let i = 0; i < wet.length; i++) wetEnergy += wet[i] * wet[i]
    expect(wetEnergy).toBeGreaterThan((0.1 * 0.1 * wet.length) / 2)
  })

  it('handles silence without NaN', () => {
    const wet = addWhiteNoise(new Float32Array(1000), 12)
    expect(wet.every(Number.isFinite)).toBe(true)
  })
})

describe('addReverb', () => {
  it('is deterministic and keeps the length', () => {
    const dry = new Float32Array(8000).fill(0.2)
    const a = addReverb(dry, 7)
    const b = addReverb(dry, 7)
    expect(sameContent(a, b)).toBe(true)
    expect(a.length).toBe(dry.length)
  })

  it('normalizes the peak to the original level', () => {
    const dry = new Float32Array(8000).fill(0.2)
    const wet = addReverb(dry)
    let peak = 0
    for (let i = 0; i < wet.length; i++) peak = Math.max(peak, Math.abs(wet[i]))
    expect(peak).toBeCloseTo(0.9, 2)
  })
})
