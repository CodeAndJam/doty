import { describe, expect, it } from 'vitest'
import { historyBoost, maxPlays, tagMatch, textOverlap } from '../../lib/scoreCandidates'

describe('candidate scoring', () => {
  describe('textOverlap', () => {
    it('scores the share of the candidate text the prompt mentions', () => {
      // 1 of 3 words matched, doubled: 2/3.
      expect(textOverlap('fire burning tree', ['fire'])).toBeCloseTo(2 / 3)
    })

    it('caps at 1 when every candidate word matches', () => {
      expect(textOverlap('sword hit', ['sword', 'hit'])).toBe(1)
    })

    it('scores 0 for an empty candidate or empty prompt', () => {
      expect(textOverlap('', ['fire'])).toBe(0)
      expect(textOverlap('fire', [])).toBe(0)
    })
  })

  describe('tagMatch', () => {
    it('weights user tags three times', () => {
      expect(tagMatch(['epic'], ['epic'])).toBe(3)
    })

    it('matches accent-insensitively across tag and prompt', () => {
      expect(tagMatch(['épico'], ['epico'])).toBe(3)
    })

    it('scores 0 when the candidate has no tags', () => {
      expect(tagMatch([], ['epic'])).toBe(0)
    })
  })

  describe('historyBoost', () => {
    it('halves the normalised play count', () => {
      expect(historyBoost(5, 10)).toBe(0.25)
      expect(historyBoost(10, 10)).toBe(0.5)
    })

    it('is 0 for an unplayed candidate', () => {
      expect(historyBoost(0, 10)).toBe(0)
      expect(historyBoost(0, 0)).toBe(0)
    })
  })

  describe('maxPlays', () => {
    it('returns the highest play count, at least 1', () => {
      expect(maxPlays({ a: 3, b: 7 })).toBe(7)
      expect(maxPlays({})).toBe(1)
    })
  })
})
