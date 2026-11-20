import { describe, expect, it } from 'vitest'
import {
  countWords,
  MIN_INTERVAL_MS,
  MIN_NEW_WORDS,
  noteRanked,
  noteSpokenWords,
  seedCadence,
  shouldRecommend,
  waitBeforeRecommending,
} from './recommendCadence'

describe('recommendation cadence', () => {
  it('ignores a single filler word however long it has been', () => {
    expect(shouldRecommend(1, 60_000)).toBe(false)
  })

  it('ignores three new words that arrive immediately', () => {
    expect(shouldRecommend(MIN_NEW_WORDS, MIN_INTERVAL_MS - 1)).toBe(false)
  })

  it('recommends once there is something new and the answer is stale', () => {
    expect(shouldRecommend(MIN_NEW_WORDS, MIN_INTERVAL_MS)).toBe(true)
    expect(shouldRecommend(12, 5_000)).toBe(true)
  })

  it('waits exactly as long as the interval asks', () => {
    expect(waitBeforeRecommending(500)).toBe(MIN_INTERVAL_MS - 500)
    expect(waitBeforeRecommending(9_000)).toBe(0)
  })

  it('counts words the way a table speaks', () => {
    expect(countWords('  entra o   dragão  ')).toBe(3)
    expect(countWords('')).toBe(0)
  })

  it('ranks again after a long session was seeded', () => {
    // The buffer was seeded from a session and then trimmed to the window. A
    // length difference across that trim goes negative and no line ever ranks;
    // the counter only sees the words that were actually spoken since.
    let cadence = seedCadence(0)
    expect(shouldRecommend(cadence.words, MIN_INTERVAL_MS)).toBe(false)

    cadence = noteSpokenWords(cadence, 'the lich wakes')
    cadence = noteSpokenWords(cadence, '')
    expect(cadence.words).toBe(3)
    expect(shouldRecommend(cadence.words, MIN_INTERVAL_MS)).toBe(true)
  })

  it('starts counting again once a ranking was applied', () => {
    let cadence = noteSpokenWords(seedCadence(0), 'a b c d e')
    cadence = noteRanked(cadence, 5_000, cadence.words)
    expect(cadence).toEqual({ words: 0, at: 5_000 })
    expect(shouldRecommend(cadence.words, 7_000)).toBe(false)
  })

  it('keeps the words spoken while a ranking was running', () => {
    let cadence = noteSpokenWords(seedCadence(0), 'a b c')
    const rankedWords = cadence.words
    cadence = noteSpokenWords(cadence, 'd e f')
    cadence = noteRanked(cadence, 5_000, rankedWords)
    expect(cadence.words).toBe(3)
  })

  it('never goes negative when the counter was reset under a ranking', () => {
    // A session switch reseeds the counter while a ranking is in flight.
    const cadence = noteRanked(seedCadence(0), 1_000, 5)
    expect(cadence.words).toBe(0)
  })
})
