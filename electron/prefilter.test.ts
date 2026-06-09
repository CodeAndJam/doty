import { describe, expect, it } from 'vitest'
import { prefilterCandidates } from './prefilter'

describe('prefilterCandidates', () => {
  it('returns all files when below maxCandidates', () => {
    const files = ['a.mp3', 'b.mp3', 'c.mp3']
    const result = prefilterCandidates('test', files, {}, 100)
    expect(result).toEqual(files)
  })

  it('limits results to maxCandidates', () => {
    const files = Array.from({ length: 200 }, (_, i) => `track-${i}.mp3`)
    const result = prefilterCandidates('test', files, {}, 100)
    expect(result).toHaveLength(100)
  })

  it('prioritizes files with keyword matches in filename', () => {
    const files = [
      'combat-drums.mp3',
      'peaceful-river.mp3',
      'combat-horns.mp3',
      ...Array.from({ length: 100 }, (_, i) => `filler-${i}.mp3`),
    ]
    const result = prefilterCandidates('combat', files, {}, 3)
    expect(result[0]).toBe('combat-drums.mp3')
    expect(result[1]).toBe('combat-horns.mp3')
  })

  it('prioritizes files with keyword matches in tags', () => {
    const files = ['track-a.mp3', 'track-b.mp3', ...Array.from({ length: 100 }, (_, i) => `filler-${i}.mp3`)]
    const tagsMap = { 'track-a.mp3': ['tavern', 'cozy'], 'track-b.mp3': ['dark'] }
    const result = prefilterCandidates('tavern music', files, tagsMap, 3)
    expect(result[0]).toBe('track-a.mp3')
  })

  it('returns first N files when transcript has no usable keywords', () => {
    const files = Array.from({ length: 200 }, (_, i) => `track-${i}.mp3`)
    const result = prefilterCandidates('a', files, {}, 100)
    expect(result).toHaveLength(100)
    expect(result).toEqual(files.slice(0, 100))
  })

  it('handles empty transcript', () => {
    const files = Array.from({ length: 200 }, (_, i) => `track-${i}.mp3`)
    const result = prefilterCandidates('', files, {}, 100)
    expect(result).toHaveLength(100)
  })
})
