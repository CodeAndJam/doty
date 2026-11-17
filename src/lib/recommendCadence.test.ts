import { describe, expect, it } from 'vitest'
import { countWords, MIN_INTERVAL_MS, MIN_NEW_WORDS, shouldRecommend, waitBeforeRecommending } from './recommendCadence'

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
})
