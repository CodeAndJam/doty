import { describe, expect, it } from 'vitest'
import { confidenceLabel, DEFAULT_AUTOPILOT_CONFIG, HIGHLIGHT_CONFIDENCE, isRecentlyPlayed } from '../../lib/autopilot'

describe('DEFAULT_AUTOPILOT_CONFIG', () => {
  it('keeps a high bar for cutting a track short, below the highlight', () => {
    // Boundaries always pick the next track; this threshold is the expensive
    // mid-track interrupt, where a wrong cut costs the scene.
    expect(DEFAULT_AUTOPILOT_CONFIG.confidenceThreshold).toBe(0.9)
    expect(HIGHLIGHT_CONFIDENCE).toBeLessThan(DEFAULT_AUTOPILOT_CONFIG.confidenceThreshold)
  })
})

describe('confidenceLabel', () => {
  it('returns Conservative for >= 0.7', () => {
    expect(confidenceLabel(0.7)).toBe('Conservative')
    expect(confidenceLabel(0.99)).toBe('Conservative')
  })

  it('returns Balanced for 0.45-0.69', () => {
    expect(confidenceLabel(0.45)).toBe('Balanced')
    expect(confidenceLabel(0.69)).toBe('Balanced')
  })

  it('returns Adventurous below 0.45', () => {
    expect(confidenceLabel(0.2)).toBe('Adventurous')
    expect(confidenceLabel(0.44)).toBe('Adventurous')
  })
})

describe('isRecentlyPlayed', () => {
  it('is true when the track played inside the avoidance window', () => {
    const now = 1_000_000
    expect(isRecentlyPlayed(now - 5 * 60_000, now, 10)).toBe(true)
  })

  it('is false when the track played before the window', () => {
    const now = 1_000_000
    expect(isRecentlyPlayed(now - 11 * 60_000, now, 10)).toBe(false)
  })

  it('is false when the track was never played', () => {
    expect(isRecentlyPlayed(undefined, 1_000_000, 10)).toBe(false)
  })
})
