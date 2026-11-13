import { describe, expect, it } from 'vitest'
import { confidentSfx, SFX_MIN_PROBABILITY } from '../../lib/sfxRank'

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
