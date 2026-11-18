import { describe, expect, it } from 'vitest'
import { confidentSfx, mergeSfxCandidates, rankAllSfx, SFX_MIN_PROBABILITY } from '../../lib/sfxRank'

describe('confidentSfx', () => {
  it('fires only effects the model is nearly certain about', () => {
    expect(confidentSfx(['door.mp3', 'roar.mp3'], [0.97, 0.6])).toEqual([{ path: 'door.mp3', probability: 0.97 }])
  })

  it('never fires on a near miss', () => {
    // 0.9 would pass the music bar and must not pass this one.
    expect(confidentSfx(['door.mp3'], [0.9])).toEqual([])
  })

  it('returns nothing rather than a loud second best', () => {
    expect(confidentSfx(['a.mp3', 'b.mp3'], [0.5, 0.4])).toEqual([])
  })

  it('orders several confident effects by probability', () => {
    const paths = ['a.mp3', 'b.mp3']
    expect(confidentSfx(paths, [0.96, 0.99]).map((c) => c.path)).toEqual(['b.mp3', 'a.mp3'])
  })

  it('survives a short probability list', () => {
    expect(confidentSfx(['a.mp3', 'b.mp3'], [0.99])).toEqual([{ path: 'a.mp3', probability: 0.99 }])
  })

  it('documents its own threshold', () => {
    expect(SFX_MIN_PROBABILITY).toBeGreaterThan(0.9)
  })
})

describe('mergeSfxCandidates', () => {
  it('puts the index answer first and keeps the keywords behind it', () => {
    expect(mergeSfxCandidates(['wind.mp3'], ['roar.mp3'], 5)).toEqual(['wind.mp3', 'roar.mp3'])
  })

  it('does not offer the same effect twice', () => {
    expect(mergeSfxCandidates(['wind.mp3', 'rain.mp3'], ['rain.mp3', 'roar.mp3'], 5)).toEqual([
      'wind.mp3',
      'rain.mp3',
      'roar.mp3',
    ])
  })

  it('stops at twice the column, which is what the model can rank', () => {
    expect(mergeSfxCandidates(['a', 'b', 'c'], ['d', 'e', 'f'], 2)).toHaveLength(4)
  })
})

describe('rankAllSfx', () => {
  it('shows the model ranking even when nothing clears the firing bar', () => {
    // The column is a suggestion: a second best costs a glance. Autopilot keeps
    // the 0.95 bar through confidentSfx.
    expect(rankAllSfx(['a.mp3', 'b.mp3', 'c.mp3'], [0.2, 0.7, 0.1]).map((c) => c.path)).toEqual([
      'b.mp3',
      'a.mp3',
      'c.mp3',
    ])
  })

  it('keeps every candidate, so the column can show what it did not suggest', () => {
    expect(rankAllSfx(['a.mp3', 'b.mp3'], [0.4, 0.6])).toEqual([
      { path: 'b.mp3', probability: 0.6 },
      { path: 'a.mp3', probability: 0.4 },
    ])
  })
})
