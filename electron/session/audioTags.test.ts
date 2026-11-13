import { describe, expect, it } from 'vitest'
import { AUDIO_VOCABULARY, tagsFromAudio, VOCAL_TAG } from './audioTags'

const v = (x: number, y: number) => Float32Array.from([x, y])

describe('tagsFromAudio', () => {
  it('names what the sound resembles, best first', () => {
    const audio = v(1, 0.1)
    const tags = tagsFromAudio(audio, [
      { phrase: 'singing with lyrics', vector: v(0, 1) },
      { phrase: 'drums and percussion', vector: v(1, 0) },
    ])
    expect(tags[0]).toBe('drums and percussion')
    expect(tags).not.toContain('singing with lyrics')
  })

  it('says nothing when nothing is close enough', () => {
    // Silence is better than a wrong tag: describeTrack feeds these to the ranker.
    expect(tagsFromAudio(v(1, 0), [{ phrase: 'rain or water', vector: v(0, 1) }])).toEqual([])
  })

  it('keeps every tag above the bar, ordered', () => {
    const tags = tagsFromAudio(
      v(1, 0),
      [
        { phrase: 'a', vector: v(1, 0) },
        { phrase: 'b', vector: v(0.9, 0.1) },
      ],
      0.5,
    )
    expect(tags).toEqual(['a', 'b'])
  })

  it('has a vocabulary small enough to reason about, with the vocal tag in it', () => {
    expect(AUDIO_VOCABULARY.length).toBeLessThanOrEqual(20)
    expect(AUDIO_VOCABULARY).toContain(VOCAL_TAG)
  })
})
