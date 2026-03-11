import { describe, it, expect } from 'vitest'
import { heuristicRecommend } from '../../lib/heuristicRecommend'
import type { TrackMeta } from '../../types'

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

const META: Record<string, TrackMeta> = {
  'Campfire.mp3':                        { bpm: 72,  bpmConfidence: 0, key: 'C', scale: 'major', danceability: 0.3, energy: 0.25, duration: 0, mtime: 0, title: null, artist: null, album: null, genre: null, year: null, trackNo: null, bitrate: null, sampleRate: null, channels: null, codec: null },
  'Decisive Battle - Rivals.mp3':        { bpm: 145, bpmConfidence: 0, key: 'D', scale: 'minor', danceability: 0.6, energy: 0.85, duration: 0, mtime: 0, title: null, artist: null, album: null, genre: null, year: null, trackNo: null, bitrate: null, sampleRate: null, channels: null, codec: null },
  'Horror Ambience - Haunted House.mp3': { bpm: 65,  bpmConfidence: 0, key: 'A', scale: 'minor', danceability: 0.2, energy: 0.35, duration: 0, mtime: 0, title: null, artist: null, album: null, genre: null, year: null, trackNo: null, bitrate: null, sampleRate: null, channels: null, codec: null },
  'Fantasy Tavern.mp3':                  { bpm: 88,  bpmConfidence: 0, key: 'G', scale: 'major', danceability: 0.5, energy: 0.4,  duration: 0, mtime: 0, title: null, artist: null, album: null, genre: null, year: null, trackNo: null, bitrate: null, sampleRate: null, channels: null, codec: null },
  'Ocean Voyage - Setting Sail Fantasy.mp3': { bpm: 105, bpmConfidence: 0, key: 'F', scale: 'major', danceability: 0.55, energy: 0.55, duration: 0, mtime: 0, title: null, artist: null, album: null, genre: null, year: null, trackNo: null, bitrate: null, sampleRate: null, channels: null, codec: null },
  'Journey - Unsafe Roads.mp3':          { bpm: 110, bpmConfidence: 0, key: 'E', scale: 'minor', danceability: 0.5, energy: 0.6,  duration: 0, mtime: 0, title: null, artist: null, album: null, genre: null, year: null, trackNo: null, bitrate: null, sampleRate: null, channels: null, codec: null },
  'Downtime - Bonfire.mp3':              { bpm: 78,  bpmConfidence: 0, key: 'C', scale: 'major', danceability: 0.35, energy: 0.3,  duration: 0, mtime: 0, title: null, artist: null, album: null, genre: null, year: null, trackNo: null, bitrate: null, sampleRate: null, channels: null, codec: null },
  'Spooky - Dark Wind.mp3':              { bpm: 70,  bpmConfidence: 0, key: 'B', scale: 'minor', danceability: 0.2, energy: 0.3,  duration: 0, mtime: 0, title: null, artist: null, album: null, genre: null, year: null, trackNo: null, bitrate: null, sampleRate: null, channels: null, codec: null },
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
