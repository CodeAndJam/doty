import { describe, expect, it } from 'vitest'
import { indexChipText, indexSummary } from './indexStatus'

const base = {
  ready: true,
  phase: 'idle' as const,
  paused: false,
  indexed: 43,
  total: 43,
  phaseDone: 0,
  phaseTotal: 0,
}

describe('index status copy', () => {
  it('is silent when idle', () => {
    expect(indexChipText(base)).toBeNull()
    expect(indexChipText(null)).toBeNull()
  })

  it('names the phase and the count while working', () => {
    expect(indexChipText({ ...base, phase: 'text', phaseDone: 12, phaseTotal: 43 })).toBe('indexing text 12/43')
    expect(indexChipText({ ...base, phase: 'audio', phaseDone: 30, phaseTotal: 43 })).toBe('indexing audio 30/43')
  })

  it('prefers the pause, because that is the surprising state', () => {
    expect(indexChipText({ ...base, paused: true, phase: 'text', phaseDone: 1, phaseTotal: 4 })).toBe(
      'paused · recording',
    )
  })

  it('says which pass ran and why it stopped', () => {
    expect(indexSummary({ ...base, indexed: 12 })).toBe('12 of 43 embedded — waiting to start')
    expect(indexSummary({ ...base, phase: 'audio', phaseDone: 30, phaseTotal: 43 })).toBe(
      '43 of 43 embedded — audio pass, 30/43',
    )
    expect(indexSummary({ ...base, paused: true, indexed: 12 })).toBe('12 of 43 embedded — paused while recording')
    expect(indexSummary(base)).toBe('43 of 43 embedded — complete')
  })

  it('says when the model is missing instead of showing zero progress', () => {
    expect(indexSummary({ ...base, ready: false, indexed: 0 })).toMatch(/not installed/)
  })
})
