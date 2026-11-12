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
})
