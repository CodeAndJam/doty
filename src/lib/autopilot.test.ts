import { describe, expect, it } from 'vitest'
import { confidenceLabel, DEFAULT_AUTOPILOT_CONFIG, isRecentlyPlayed } from './autopilot'

describe('DEFAULT_AUTOPILOT_CONFIG', () => {
  it('starts with the master switch off: nothing changes on its own until asked', () => {
    expect(DEFAULT_AUTOPILOT_CONFIG.enabled).toBe(false)
  })
})

describe('confidenceLabel', () => {
  it('names the three bars', () => {
    expect(confidenceLabel(0.9)).toBe('Conservative')
    expect(confidenceLabel(0.5)).toBe('Balanced')
    expect(confidenceLabel(0.2)).toBe('Adventurous')
  })
})

describe('isRecentlyPlayed', () => {
  it('counts a track inside the window and not one outside it', () => {
    const now = 10_000_000
    expect(isRecentlyPlayed(now - 60_000, now, 10)).toBe(true)
    expect(isRecentlyPlayed(now - 11 * 60_000, now, 10)).toBe(false)
    expect(isRecentlyPlayed(undefined, now, 10)).toBe(false)
  })
})
