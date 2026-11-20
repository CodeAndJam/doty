import { describe, expect, it } from 'vitest'
import { CONTEXT_LIMITS, type ContextConfig, composeState, DEFAULT_CONTEXT, normalizeContext } from './context'

const KEYS = Object.keys(DEFAULT_CONTEXT) as Array<keyof ContextConfig>

describe('normalizeContext', () => {
  it('fills every field from the defaults', () => {
    expect(normalizeContext(undefined)).toEqual(DEFAULT_CONTEXT)
    expect(normalizeContext({})).toEqual(DEFAULT_CONTEXT)
  })

  it('returns a fresh object rather than the defaults themselves', () => {
    expect(normalizeContext(undefined)).not.toBe(DEFAULT_CONTEXT)
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
    expect(high).toEqual({ windowChars: 8000, rankerChars: 4000, sfxChars: 4000, hintChars: 2000, debounceMs: 10000 })
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
})
