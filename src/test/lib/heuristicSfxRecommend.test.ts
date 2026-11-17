import { describe, expect, it } from 'vitest'
import { heuristicSfxRecommend } from '../../lib/heuristicSfxRecommend'
import type { SfxMeta } from '../../types'

const SFX: SfxMeta[] = [
  {
    id: 'sword',
    filename: 'sword.wav',
    category: 'combat',
    label: 'Sword Clash',
    description: 'metal blade hit',
    duration: 1,
    source: 'builtin',
  },
  {
    id: 'fire',
    filename: 'fire.wav',
    category: 'fire',
    label: 'Campfire Crackle',
    description: 'warm fire',
    duration: 2,
    source: 'builtin',
  },
  {
    id: 'thunder',
    filename: 'thunder.wav',
    category: 'nature',
    label: 'Thunder Storm',
    description: 'rain and thunder',
    duration: 3,
    source: 'builtin',
  },
]

describe('heuristicSfxRecommend', () => {
  it('ranks combat SFX for an English battle prompt', () => {
    expect(heuristicSfxRecommend('sword battle', SFX, 3)[0]).toBe('sword')
  })

  it('matches Portuguese keywords', () => {
    expect(heuristicSfxRecommend('o grupo entra em batalha com a espada', SFX, 3)[0]).toBe('sword')
  })

  it('matches accentless Portuguese against accented keywords', () => {
    expect(heuristicSfxRecommend('trovao e chuva', SFX, 3)[0]).toBe('thunder')
  })

  it('matches European Portuguese vocabulary', () => {
    expect(heuristicSfxRecommend('um dragão ataca o grupo', SFX, 3)[0]).toBe('sword')
    expect(heuristicSfxRecommend('a lareira está acesa', SFX, 3)[0]).toBe('fire')
  })

  it('fills the count from the shelf when history only knows one effect', () => {
    // One played effect is a boost, not the whole column: this returned a single
    // card where five were configured.
    const played = heuristicSfxRecommend('', SFX, 3, {}, { thunder: 4 })
    expect(played).toHaveLength(3)
    expect(played[0]).toBe('thunder')
    expect(new Set(played).size).toBe(3)
  })

  it('keeps history first when there is more of it than the count allows', () => {
    const played = heuristicSfxRecommend('', SFX, 2, {}, { fire: 1, thunder: 9 })
    expect(played).toEqual(['thunder', 'fire'])
  })
})
