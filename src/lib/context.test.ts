import { describe, expect, it } from 'vitest'
import {
  CONTEXT_LIMITS,
  type ContextConfig,
  composeState,
  DEFAULT_CONTEXT,
  embedQuery,
  MODEL_STATE_CHARS,
  mergeContext,
  normalizeContext,
  seedWindow,
} from './context'

const KEYS = Object.keys(CONTEXT_LIMITS) as Array<keyof ContextConfig>

describe('normalizeContext', () => {
  it('caps the state where the 1024-token row runs out', () => {
    expect(MODEL_STATE_CHARS).toBe(1400)
  })

  it('ships the defaults the rest of the app was built on', () => {
    expect(DEFAULT_CONTEXT).toEqual({
      windowChars: 800,
      rankerChars: 500,
      sfxChars: 500,
      hintChars: 300,
      debounceMs: 1500,
    })
  })

  it('fills every field from the defaults', () => {
    expect(normalizeContext(undefined)).toEqual(DEFAULT_CONTEXT)
    expect(normalizeContext({})).toEqual(DEFAULT_CONTEXT)
  })

  it('returns a fresh object rather than the input or the defaults', () => {
    expect(normalizeContext(undefined)).not.toBe(DEFAULT_CONTEXT)
    const patch = { windowChars: 900 }
    expect(normalizeContext(patch)).not.toBe(patch)
    normalizeContext({ windowChars: 1e9 })
    expect(DEFAULT_CONTEXT.windowChars).toBe(800)
  })

  it('clamps every field to its limits, low and high', () => {
    const low = normalizeContext({ windowChars: 0, rankerChars: 0, sfxChars: 0, hintChars: -5, debounceMs: 0 })
    expect(low).toEqual({ windowChars: 200, rankerChars: 100, sfxChars: 100, hintChars: 0, debounceMs: 250 })

    const high = normalizeContext({
      windowChars: 1e9,
      rankerChars: 1e9,
      sfxChars: 1e9,
      hintChars: 1e9,
      debounceMs: 1e9,
    })
    expect(high).toEqual({
      windowChars: 8000,
      rankerChars: MODEL_STATE_CHARS,
      sfxChars: MODEL_STATE_CHARS,
      hintChars: MODEL_STATE_CHARS,
      debounceMs: 10000,
    })
  })

  it('keeps a default that lies outside its own limits impossible', () => {
    for (const key of KEYS) {
      expect(DEFAULT_CONTEXT[key]).toBeGreaterThanOrEqual(CONTEXT_LIMITS[key][0])
      expect(DEFAULT_CONTEXT[key]).toBeLessThanOrEqual(CONTEXT_LIMITS[key][1])
    }
  })

  it('rounds a fractional value', () => {
    expect(normalizeContext({ windowChars: 200.6 }).windowChars).toBe(201)
  })

  it('keeps the default for a field that is missing or not a number', () => {
    const out = normalizeContext({ ...DEFAULT_CONTEXT, rankerChars: Number.NaN, sfxChars: 'x' as unknown as number })
    expect(out.rankerChars).toBe(DEFAULT_CONTEXT.rankerChars)
    expect(out.sfxChars).toBe(DEFAULT_CONTEXT.sfxChars)
  })
})

describe('composeState', () => {
  const budget = { hintChars: 10, transcriptChars: 12 }

  it('reads the hint before the room', () => {
    expect(composeState('tomb', 'they open the door', budget)).toBe('tomb\npen the door')
  })

  it('caps the hint at hintChars', () => {
    expect(composeState('0123456789abcdef', 'x', budget)).toBe('0123456789\nx')
  })

  it('drops empty parts instead of leaving a blank line', () => {
    expect(composeState('', 'they open the door', budget)).toBe('pen the door')
    expect(composeState('tomb', '   ', budget)).toBe('tomb')
    expect(composeState('', '', budget)).toBe('')
  })

  it('treats a zero budget as nothing, not as the whole string', () => {
    expect(composeState('tomb', 'they open the door', { hintChars: 0, transcriptChars: 0 })).toBe('')
    expect(composeState('tomb', 'they open the door', { hintChars: 10, transcriptChars: 0 })).toBe('tomb')
  })

  it('treats a whitespace-only hint as empty', () => {
    expect(composeState('   ', 'they open the door', budget)).toBe('pen the door')
  })

  it('caps the state at the row, hint first', () => {
    const long = composeState('h'.repeat(2000), 'w '.repeat(2000), { hintChars: 2000, transcriptChars: 4000 })
    expect(long).toBe('h'.repeat(MODEL_STATE_CHARS))
  })

  it('drops the room when the hint fills the row', () => {
    const text = composeState('tomb '.repeat(300), 'they open the door', {
      hintChars: MODEL_STATE_CHARS,
      transcriptChars: 500,
    })
    expect(text.startsWith('tomb tomb')).toBe(true)
    expect(text).not.toContain('door')
  })

  it('keeps the newest words when the transcript has to give way', () => {
    const text = composeState('tomb', `old ${'m'.repeat(3000)} newest`, { hintChars: 10, transcriptChars: 4000 })
    expect(text.startsWith('tomb\n')).toBe(true)
    expect(text.endsWith('newest')).toBe(true)
    expect(text.length).toBeLessThanOrEqual(MODEL_STATE_CHARS)
  })
})

describe('seedWindow', () => {
  it('keeps the newest words within the budget', () => {
    const seeded = seedWindow(['old words', 'the lich wakes'], 13)
    expect(seeded).toHaveLength(13)
    expect('the lich wakes'.endsWith(seeded)).toBe(true)
    expect(seedWindow(['old words', 'the lich wakes'], 100)).toBe('old words the lich wakes')
    expect(seedWindow(['', 'only this'], 100)).toBe('only this')
  })
})

describe('embedQuery', () => {
  it('leaves a short state alone', () => {
    expect(embedQuery('the lich wakes')).toBe('the lich wakes')
    expect(embedQuery('x'.repeat(400))).toBe('x'.repeat(400))
  })

  it('keeps the hint at the head and the newest words at the tail', () => {
    const hint = `hint:${'h'.repeat(95)}`
    const query = embedQuery(`${hint} ${'m'.repeat(2000)} newest`)
    expect(query.startsWith(hint)).toBe(true)
    expect(query.endsWith(`${'m'.repeat(2000)} newest`.slice(-300))).toBe(true)
    expect(query.length).toBe(401)
  })
})

describe('mergeContext', () => {
  it('keeps the stored fields a patch does not mention', () => {
    const merged = mergeContext({ windowChars: 2000 }, { hintChars: 0 })
    expect(merged.windowChars).toBe(2000)
    expect(merged.hintChars).toBe(0)
  })

  it('clamps the merged result to its own bounds', () => {
    expect(mergeContext({ windowChars: 200 }, { rankerChars: 4000 }).rankerChars).toBe(MODEL_STATE_CHARS)
  })
})
