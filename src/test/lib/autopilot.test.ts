import { describe, expect, it } from 'vitest'
import { confidenceLabel, DEFAULT_AUTOPILOT_CONFIG, HIGHLIGHT_CONFIDENCE, isRecentlyPlayed } from '../../lib/autopilot'

describe('DEFAULT_AUTOPILOT_CONFIG', () => {
  it('acts on a calibrated 0.9 and highlights above 0.7', () => {
    expect(DEFAULT_AUTOPILOT_CONFIG.confidenceThreshold).toBe(0.9)
    expect(HIGHLIGHT_CONFIDENCE).toBeLessThan(DEFAULT_AUTOPILOT_CONFIG.confidenceThreshold)
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
