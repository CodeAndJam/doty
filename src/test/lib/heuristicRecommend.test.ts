import { describe, it, expect } from 'vitest'
import { heuristicRecommend } from '../../lib/heuristicRecommend'

const FILES = [
  'Campfire.mp3',
  'Decisive Battle - Rivals.mp3',
  'Horror Ambience - Haunted House.mp3',
  'Fantasy Tavern.mp3',
  'Ocean Voyage - Setting Sail Fantasy.mp3',
  'Journey - Unsafe Roads.mp3',
  'Downtime - Bonfire.mp3',
  'Spooky - Dark Wind.mp3',
]

const META: Record<string, { bpm: number; key: string; scale: string; danceability: number; energy: number }> = {
  'Campfire.mp3':                        { bpm: 72,  key: 'C', scale: 'major', danceability: 0.3, energy: 0.25 },
  'Decisive Battle - Rivals.mp3':        { bpm: 145, key: 'D', scale: 'minor', danceability: 0.6, energy: 0.85 },
  'Horror Ambience - Haunted House.mp3': { bpm: 65,  key: 'A', scale: 'minor', danceability: 0.2, energy: 0.35 },
  'Fantasy Tavern.mp3':                  { bpm: 88,  key: 'G', scale: 'major', danceability: 0.5, energy: 0.4  },
  'Ocean Voyage - Setting Sail Fantasy.mp3': { bpm: 105, key: 'F', scale: 'major', danceability: 0.55, energy: 0.55 },
  'Journey - Unsafe Roads.mp3':          { bpm: 110, key: 'E', scale: 'minor', danceability: 0.5, energy: 0.6  },
  'Downtime - Bonfire.mp3':              { bpm: 78,  key: 'C', scale: 'major', danceability: 0.35, energy: 0.3  },
  'Spooky - Dark Wind.mp3':              { bpm: 70,  key: 'B', scale: 'minor', danceability: 0.2, energy: 0.3  },
}

describe('heuristicRecommend', () => {
  it('returns 5 results', () => {
    const results = heuristicRecommend('campfire rest', FILES, META)
    expect(results).toHaveLength(5)
  })

  it('ranks campfire/tavern tracks first for calm transcript', () => {
    const results = heuristicRecommend('sitting by the campfire resting at the tavern', FILES, META)
    expect(results[0]).toMatch(/Campfire|Tavern|Bonfire/i)
  })

  it('ranks battle tracks first for combat transcript', () => {
    const results = heuristicRecommend('the party enters combat battle against the enemy', FILES, META)
    expect(results[0]).toMatch(/Battle|Rivals/i)
  })

  it('ranks horror tracks first for spooky transcript', () => {
    const results = heuristicRecommend('the haunted house is dark and spooky', FILES, META)
    expect(results[0]).toMatch(/Horror|Spooky|Haunted/i)
  })

  it('returns all files if fewer than 5', () => {
    const results = heuristicRecommend('campfire', FILES.slice(0, 3), META)
    expect(results).toHaveLength(3)
  })

  it('works without metadata (filename-only scoring)', () => {
    const results = heuristicRecommend('ocean voyage sailing', FILES, {})
    expect(results).toHaveLength(5)
    expect(results[0]).toMatch(/Ocean|Voyage/i)
  })

  it('returns empty array for empty files', () => {
    expect(heuristicRecommend('campfire', [], META)).toEqual([])
  })
})
