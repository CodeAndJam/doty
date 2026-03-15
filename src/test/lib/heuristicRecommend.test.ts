import { describe, expect, it } from 'vitest'
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
  'Campfire.mp3': {
    bpm: 72,
    bpmConfidence: 0,
    key: 'C',
    scale: 'major',
    danceability: 0.3,
    energy: 0.25,
    duration: 0,
    mtime: 0,
    title: null,
    artist: null,
    album: null,
    genre: null,
    year: null,
    trackNo: null,
    bitrate: null,
    sampleRate: null,
    channels: null,
    codec: null,
  },
  'Decisive Battle - Rivals.mp3': {
    bpm: 145,
    bpmConfidence: 0,
    key: 'D',
    scale: 'minor',
    danceability: 0.6,
    energy: 0.85,
    duration: 0,
    mtime: 0,
    title: null,
    artist: null,
    album: null,
    genre: null,
    year: null,
    trackNo: null,
    bitrate: null,
    sampleRate: null,
    channels: null,
    codec: null,
  },
  'Horror Ambience - Haunted House.mp3': {
    bpm: 65,
    bpmConfidence: 0,
    key: 'A',
    scale: 'minor',
    danceability: 0.2,
    energy: 0.35,
    duration: 0,
    mtime: 0,
    title: null,
    artist: null,
    album: null,
    genre: null,
    year: null,
    trackNo: null,
    bitrate: null,
    sampleRate: null,
    channels: null,
    codec: null,
  },
  'Fantasy Tavern.mp3': {
    bpm: 88,
    bpmConfidence: 0,
    key: 'G',
    scale: 'major',
    danceability: 0.5,
    energy: 0.4,
    duration: 0,
    mtime: 0,
    title: null,
    artist: null,
    album: null,
    genre: null,
    year: null,
    trackNo: null,
    bitrate: null,
    sampleRate: null,
    channels: null,
    codec: null,
  },
  'Ocean Voyage - Setting Sail Fantasy.mp3': {
    bpm: 105,
    bpmConfidence: 0,
    key: 'F',
    scale: 'major',
    danceability: 0.55,
    energy: 0.55,
    duration: 0,
    mtime: 0,
    title: null,
    artist: null,
    album: null,
    genre: null,
    year: null,
    trackNo: null,
    bitrate: null,
    sampleRate: null,
    channels: null,
    codec: null,
  },
  'Journey - Unsafe Roads.mp3': {
    bpm: 110,
    bpmConfidence: 0,
    key: 'E',
    scale: 'minor',
    danceability: 0.5,
    energy: 0.6,
    duration: 0,
    mtime: 0,
    title: null,
    artist: null,
    album: null,
    genre: null,
    year: null,
    trackNo: null,
    bitrate: null,
    sampleRate: null,
    channels: null,
    codec: null,
  },
  'Downtime - Bonfire.mp3': {
    bpm: 78,
    bpmConfidence: 0,
    key: 'C',
    scale: 'major',
    danceability: 0.35,
    energy: 0.3,
    duration: 0,
    mtime: 0,
    title: null,
    artist: null,
    album: null,
    genre: null,
    year: null,
    trackNo: null,
    bitrate: null,
    sampleRate: null,
    channels: null,
    codec: null,
  },
  'Spooky - Dark Wind.mp3': {
    bpm: 70,
    bpmConfidence: 0,
    key: 'B',
    scale: 'minor',
    danceability: 0.2,
    energy: 0.3,
    duration: 0,
    mtime: 0,
    title: null,
    artist: null,
    album: null,
    genre: null,
    year: null,
    trackNo: null,
    bitrate: null,
    sampleRate: null,
    channels: null,
    codec: null,
  },
}

describe('heuristicRecommend', () => {
  it('returns 5 results', () => {
    const { files } = heuristicRecommend('campfire rest', FILES, META)
    expect(files).toHaveLength(5)
  })

  it('ranks campfire/tavern tracks first for calm transcript', () => {
    const { files } = heuristicRecommend('sitting by the campfire resting at the tavern', FILES, META)
    expect(files[0]).toMatch(/Campfire|Tavern|Bonfire/i)
  })

  it('ranks battle tracks first for combat transcript', () => {
    const { files } = heuristicRecommend('the party enters combat battle against the enemy', FILES, META)
    expect(files[0]).toMatch(/Battle|Rivals/i)
  })

  it('ranks horror tracks first for spooky transcript', () => {
    const { files } = heuristicRecommend('the haunted house is dark and spooky', FILES, META)
    expect(files[0]).toMatch(/Horror|Spooky|Haunted/i)
  })

  it('returns all files if fewer than 5', () => {
    const { files } = heuristicRecommend('campfire', FILES.slice(0, 3), META)
    expect(files).toHaveLength(3)
  })

  it('works without metadata (filename-only scoring)', () => {
    const { files } = heuristicRecommend('ocean voyage sailing', FILES, {})
    expect(files).toHaveLength(5)
    expect(files[0]).toMatch(/Ocean|Voyage/i)
  })

  it('returns empty array for empty files', () => {
    expect(heuristicRecommend('campfire', [], META).files).toEqual([])
  })

  it('boosts tracks with matching tags over filename-only matches', () => {
    const tagsMap: Record<string, string[]> = {
      'Journey - Unsafe Roads.mp3': ['combat', 'intense'],
    }
    const { files } = heuristicRecommend('combat', FILES, META, 5, tagsMap)
    // Journey has a 'combat' tag — should rank higher than it would without tags
    expect(files).toContain('Journey - Unsafe Roads.mp3')
    // Decisive Battle has 'battle' in filename but no 'combat' tag
    const journeyIdx = files.indexOf('Journey - Unsafe Roads.mp3')
    const battleIdx = files.indexOf('Decisive Battle - Rivals.mp3')
    expect(journeyIdx).toBeLessThan(battleIdx)
  })

  it('ranks tagged track first when transcript matches tag exactly', () => {
    const tagsMap: Record<string, string[]> = {
      'Campfire.mp3': ['tavern', 'peaceful'],
      'Fantasy Tavern.mp3': ['boss', 'combat'],
    }
    // 'boss' in transcript should boost Fantasy Tavern (tagged 'boss') above Campfire
    const { files } = heuristicRecommend('boss fight', FILES, META, 5, tagsMap)
    expect(files[0]).toBe('Fantasy Tavern.mp3')
  })

  it('works with tagsMap but no metadata', () => {
    const tagsMap: Record<string, string[]> = {
      'Campfire.mp3': ['ocean', 'voyage'],
    }
    const { files } = heuristicRecommend('ocean voyage', FILES, {}, 5, tagsMap)
    // Both Campfire (tagged) and Ocean Voyage (filename) should rank high
    expect(files.slice(0, 2)).toContain('Campfire.mp3')
    expect(files.slice(0, 2)).toContain('Ocean Voyage - Setting Sail Fantasy.mp3')
  })

  it('returns confidence > 0 when mood keywords match', () => {
    const { confidence } = heuristicRecommend('the party enters combat battle against the enemy', FILES, META)
    expect(confidence).toBeGreaterThan(0)
  })

  it('returns confidence 0 for empty transcript', () => {
    const { confidence } = heuristicRecommend('', FILES, META)
    expect(confidence).toBe(0)
  })

  it('matches Portuguese keywords for battle mood', () => {
    const { files } = heuristicRecommend('o grupo entra em combate batalha contra o inimigo', FILES, META)
    expect(files[0]).toMatch(/Battle|Rivals/i)
  })

  it('matches Portuguese keywords for calm mood', () => {
    const { files } = heuristicRecommend('descansando na taverna perto da fogueira', FILES, META)
    expect(files[0]).toMatch(/Campfire|Tavern|Bonfire/i)
  })

  it('preserves accented characters in tokenizer', () => {
    const { files } = heuristicRecommend('celebração vitória épico', FILES, META)
    // Should match victory mood profile
    expect(files).toHaveLength(5)
  })
})
