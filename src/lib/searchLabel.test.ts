import { describe, expect, it } from 'vitest'
import { searchModeLabel } from './searchLabel'

const status = {
  ready: true,
  phase: 'idle' as const,
  paused: false,
  indexed: 12,
  total: 43,
  phaseDone: 0,
  phaseTotal: 0,
}

describe('search mode label', () => {
  it('says nothing about mechanics when the vectors answered', () => {
    expect(searchModeLabel('semantic', status)).toBe('best match')
  })

  it('explains an incomplete index with its numbers', () => {
    expect(searchModeLabel('text', status)).toBe('by name — index 12/43')
  })

  it('explains a missing model instead of showing a count', () => {
    expect(searchModeLabel('text', { ...status, ready: false, indexed: 0 })).toBe('by name — no embedding model')
  })

  it('stays quiet when the index is complete but text answered anyway', () => {
    expect(searchModeLabel('text', { ...status, indexed: 43 })).toBe('by name')
  })
})
