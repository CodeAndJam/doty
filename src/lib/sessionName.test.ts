import { describe, expect, it } from 'vitest'
import { defaultSessionName } from './sessionName'

describe('defaultSessionName', () => {
  it('names the session after the moment it started', () => {
    expect(defaultSessionName(new Date(2026, 10, 16, 9, 6))).toBe('Session 16 Nov 09:06')
  })

  it('never produces an empty name', () => {
    expect(defaultSessionName(new Date(2026, 0, 1, 0, 0)).trim().length).toBeGreaterThan(10)
  })
})
