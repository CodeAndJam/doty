import { describe, expect, it } from 'vitest'
import { confidenceLabel, softmax, topConfidence } from '../../lib/autopilot'

describe('softmax', () => {
  it('returns empty array for empty input', () => {
    expect(softmax([])).toEqual([])
  })

  it('returns [1] for single element', () => {
    const result = softmax([5.0])
    expect(result).toHaveLength(1)
    expect(result[0]).toBeCloseTo(1.0)
  })

  it('sums to 1.0', () => {
    const result = softmax([1.0, 2.0, 3.0])
    const sum = result.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1.0)
  })

  it('highest logit gets highest probability', () => {
    const result = softmax([1.0, 5.0, 2.0])
    expect(result[1]).toBeGreaterThan(result[0])
    expect(result[1]).toBeGreaterThan(result[2])
  })

  it('equal logits produce uniform distribution', () => {
    const result = softmax([3.0, 3.0, 3.0])
    expect(result[0]).toBeCloseTo(1 / 3)
    expect(result[1]).toBeCloseTo(1 / 3)
    expect(result[2]).toBeCloseTo(1 / 3)
  })

  it('handles large logit differences without overflow', () => {
    const result = softmax([1000, 0, -1000])
    expect(result[0]).toBeCloseTo(1.0)
    expect(result[1]).toBeCloseTo(0.0)
    expect(result[2]).toBeCloseTo(0.0)
  })

  it('handles negative logits', () => {
    const result = softmax([-4.86, -10.83, -9.2])
    const sum = result.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1.0)
    expect(result[0]).toBeGreaterThan(result[1])
    expect(result[0]).toBeGreaterThan(result[2])
  })
})

describe('topConfidence', () => {
  it('returns index -1 and confidence 0 for empty input', () => {
    const result = topConfidence([])
    expect(result.index).toBe(-1)
    expect(result.confidence).toBe(0)
  })

  it('returns index 0 and confidence 1.0 for single element', () => {
    const result = topConfidence([5.0])
    expect(result.index).toBe(0)
    expect(result.confidence).toBeCloseTo(1.0)
  })

  it('identifies the highest-scoring candidate', () => {
    const result = topConfidence([1.0, 5.0, 2.0])
    expect(result.index).toBe(1)
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it('returns high confidence when one logit dominates', () => {
    const result = topConfidence([10.0, 0.0, 0.0])
    expect(result.index).toBe(0)
    expect(result.confidence).toBeGreaterThan(0.99)
  })

  it('returns low confidence when logits are similar', () => {
    const result = topConfidence([1.0, 1.1, 0.9])
    expect(result.confidence).toBeLessThan(0.5)
  })

  it('works with real reranker-like negative logits', () => {
    // Typical reranker output: negative logits with varying magnitudes
    const result = topConfidence([-4.86, -10.83, -9.2])
    expect(result.index).toBe(0)
    expect(result.confidence).toBeGreaterThan(0.9)
  })
})

describe('confidenceLabel', () => {
  it('returns Conservative for >= 0.95', () => {
    expect(confidenceLabel(0.95)).toBe('Conservative')
    expect(confidenceLabel(0.99)).toBe('Conservative')
  })

  it('returns Balanced for 0.90-0.94', () => {
    expect(confidenceLabel(0.9)).toBe('Balanced')
    expect(confidenceLabel(0.94)).toBe('Balanced')
  })

  it('returns Adventurous for < 0.90', () => {
    expect(confidenceLabel(0.8)).toBe('Adventurous')
    expect(confidenceLabel(0.89)).toBe('Adventurous')
  })
})
