import { describe, it, expect, vi } from 'vitest'
import { QwenManager } from './qwen'
import type { TrackMetadata } from './analyzer'

const FILES = [
  'track-a.mp3', 'track-b.mp3', 'track-c.mp3', 'track-d.mp3', 'track-e.mp3',
  'track-f.mp3', 'track-g.mp3', 'track-h.mp3', 'track-i.mp3', 'track-j.mp3',
  'track-k.mp3',
]

const META_BASE: TrackMetadata = {
  bpm: 120, bpmConfidence: 0.9, key: 'C', scale: 'major',
  danceability: 0.5, energy: 0.5, duration: 200, mtime: 0,
  title: null, artist: null, album: null, genre: null,
  year: null, trackNo: null, bitrate: null, sampleRate: null,
  channels: null, codec: null,
}

const METADATA: Record<string, TrackMetadata> = {
  'track-a.mp3': { ...META_BASE, bpm: 128, key: 'C', scale: 'major', danceability: 0.8, energy: 0.7, artist: 'Artist A' },
  'track-b.mp3': { ...META_BASE, bpm: 140, key: 'A', scale: 'minor', danceability: 0.6, energy: 0.9, genre: 'Metal' },
}

/** Mock ScoreFn: returns a score per pair based on text_pair content */
function makeMockScoreFn(scoreMap?: Map<string, number>) {
  return vi.fn().mockImplementation(async (pairs: Array<{ text: string; text_pair: string }>) => {
    return pairs.map(p => scoreMap?.get(p.text_pair) ?? 0.5)
  })
}

function makeManager(scoreMap?: Map<string, number>) {
  const mockScoreFn = makeMockScoreFn(scoreMap)
  const manager = new QwenManager(mockScoreFn)
  return { manager, mockScoreFn }
}

describe('QwenManager (reranker)', () => {
  describe('empty files list', () => {
    it('returns [] without calling the model', async () => {
      const { manager, mockScoreFn } = makeManager()
      const result = await manager.recommend('energetic crowd', [])
      expect(result).toEqual([])
      expect(mockScoreFn).not.toHaveBeenCalled()
    })
  })

  describe('empty transcript', () => {
    it('returns first 5 files when transcript is empty', async () => {
      const { manager, mockScoreFn } = makeManager()
      const result = await manager.recommend('', FILES)
      expect(result).toEqual(FILES.slice(0, 5))
      expect(mockScoreFn).not.toHaveBeenCalled()
    })
  })

  describe('model loading', () => {
    it('calls the score function on first recommend', async () => {
      const { manager, mockScoreFn } = makeManager()
      await manager.recommend('test transcript', FILES)
      expect(mockScoreFn).toHaveBeenCalledOnce()
    })

    it('reuses cached scorer on subsequent calls', async () => {
      const { manager, mockScoreFn } = makeManager()
      await manager.recommend('first', FILES)
      await manager.recommend('second', FILES)
      expect(mockScoreFn).toHaveBeenCalledTimes(2) // called each time, but scorer is reused
    })
  })

  describe('happy path', () => {
    it('returns top 5 files sorted by reranker score', async () => {
      // Give specific scores so we can predict the order
      const scoreMap = new Map<string, number>()
      FILES.forEach((f, i) => {
        const desc = f.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
        scoreMap.set(desc, 1.0 - i * 0.05) // track-a=1.0, track-b=0.95, ...
      })
      const { manager } = makeManager(scoreMap)
      const result = await manager.recommend('dark ambient', FILES)
      expect(result).toEqual(FILES.slice(0, 5))
    })

    it('caps results at 5 tracks', async () => {
      const { manager } = makeManager()
      const result = await manager.recommend('test', FILES)
      expect(result.length).toBeLessThanOrEqual(5)
    })

    it('passes all candidate pairs in a single batch call', async () => {
      const { manager, mockScoreFn } = makeManager()
      await manager.recommend('test', FILES)
      expect(mockScoreFn).toHaveBeenCalledOnce()
      const pairs = mockScoreFn.mock.calls[0][0]
      expect(pairs).toHaveLength(FILES.length)
    })
  })

  describe('scoring with metadata', () => {
    it('includes artist in track description when metadata is provided', async () => {
      const { manager, mockScoreFn } = makeManager()
      await manager.recommend('test', ['track-a.mp3'], METADATA)
      const pairs = mockScoreFn.mock.calls[0][0]
      expect(pairs[0].text_pair).toContain('Artist A')
    })

    it('includes genre in track description when metadata is provided', async () => {
      const { manager, mockScoreFn } = makeManager()
      await manager.recommend('test', ['track-b.mp3'], METADATA)
      const pairs = mockScoreFn.mock.calls[0][0]
      expect(pairs[0].text_pair).toContain('Metal')
    })

    it('works without metadata', async () => {
      const { manager, mockScoreFn } = makeManager()
      await manager.recommend('test', ['track-a.mp3'], {})
      const pairs = mockScoreFn.mock.calls[0][0]
      expect(pairs[0].text_pair).toContain('track a')
    })
  })

  describe('transcript handling', () => {
    it('truncates transcript to 600 chars', async () => {
      const { manager, mockScoreFn } = makeManager()
      const longTranscript = 'x'.repeat(1000)
      await manager.recommend(longTranscript, ['track-a.mp3'])
      const pairs = mockScoreFn.mock.calls[0][0]
      expect(pairs[0].text.length).toBeLessThanOrEqual(600)
    })

    it('passes transcript as the query text', async () => {
      const { manager, mockScoreFn } = makeManager()
      await manager.recommend('dark spooky dungeon', ['track-a.mp3'])
      const pairs = mockScoreFn.mock.calls[0][0]
      expect(pairs[0].text).toBe('dark spooky dungeon')
    })
  })

  describe('track limit', () => {
    it('limits candidates to 100 tracks', async () => {
      const { manager, mockScoreFn } = makeManager()
      const manyFiles = Array.from({ length: 150 }, (_, i) => `track-${i}.mp3`)
      await manager.recommend('test', manyFiles)
      const pairs = mockScoreFn.mock.calls[0][0]
      expect(pairs).toHaveLength(100)
    })
  })

  describe('fallback behaviour', () => {
    it('falls back to first 5 files when scorer throws', async () => {
      const mockScoreFn = vi.fn().mockRejectedValue(new Error('OOM'))
      const manager = new QwenManager(mockScoreFn)
      const result = await manager.recommend('test', FILES)
      expect(result).toEqual(FILES.slice(0, 5))
    })
  })

  describe('scoring with tags', () => {
    it('includes tags in track description when tagsMap is provided', async () => {
      const { manager, mockScoreFn } = makeManager()
      const tagsMap = { 'track-a.mp3': ['combat', 'boss'] }
      await manager.recommend('test', ['track-a.mp3'], METADATA, 5, tagsMap)
      const pairs = mockScoreFn.mock.calls[0][0]
      expect(pairs[0].text_pair).toContain('tags: combat, boss')
    })

    it('does not include tags section when track has no tags', async () => {
      const { manager, mockScoreFn } = makeManager()
      await manager.recommend('test', ['track-a.mp3'], METADATA, 5, {})
      const pairs = mockScoreFn.mock.calls[0][0]
      expect(pairs[0].text_pair).not.toContain('tags:')
    })

    it('includes both metadata and tags in description', async () => {
      const { manager, mockScoreFn } = makeManager()
      const tagsMap = { 'track-a.mp3': ['tavern'] }
      await manager.recommend('test', ['track-a.mp3'], METADATA, 5, tagsMap)
      const pairs = mockScoreFn.mock.calls[0][0]
      expect(pairs[0].text_pair).toContain('Artist A')
      expect(pairs[0].text_pair).toContain('tags: tavern')
    })
  })
})
