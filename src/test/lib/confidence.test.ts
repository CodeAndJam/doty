import { describe, expect, it } from 'vitest'
import { choiceConfidence, formatProbability } from '../../lib/confidence'

describe('choiceConfidence', () => {
  it('is 0 when the probability is spread evenly', () => {
    expect(choiceConfidence([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(0, 6)
    expect(choiceConfidence(new Array(20).fill(1 / 20))).toBeCloseTo(0, 6)
  })

  it('is 1 when one option takes everything', () => {
    expect(choiceConfidence([1, 0, 0, 0])).toBeCloseTo(1, 6)
  })

  it('follows the Choice formula, not the raw top probability', () => {
    // docs.typesafe.ai/confidence: (p_max - 1/n) / (1 - 1/n)
    expect(choiceConfidence([0.75, 0.25])).toBeCloseTo(0.5, 6)
    expect(choiceConfidence([0.5, 0.25, 0.25])).toBeCloseTo(0.25, 6)
  })

  it('ignores how the rest of the mass is spread', () => {
    expect(choiceConfidence([0.6, 0.3, 0.1])).toBeCloseTo(choiceConfidence([0.6, 0.2, 0.2]), 6)
  })

  it('is 1 for a single option and 0 for none', () => {
    expect(choiceConfidence([1])).toBe(1)
    expect(choiceConfidence([])).toBe(0)
  })
})

describe('formatProbability', () => {
  it('keeps a decimal below 10% so small shares are not all 0%', () => {
    expect(formatProbability(0.041)).toBe('4.1%')
    expect(formatProbability(0.004)).toBe('0.4%')
  })

  it('rounds to whole percent above 10%', () => {
    expect(formatProbability(0.92)).toBe('92%')
    expect(formatProbability(0.105)).toBe('11%')
  })

  it('shows 0% for no probability at all', () => {
    expect(formatProbability(0)).toBe('0%')
  })
})
