import { describe, expect, it } from 'vitest'
import { composeState, DEFAULT_CONTEXT, normalizeContext } from './context'

describe('normalizeContext', () => {
  it('fills every field from the defaults', () => {
    expect(normalizeContext(undefined)).toEqual(DEFAULT_CONTEXT)
    expect(normalizeContext({})).toEqual(DEFAULT_CONTEXT)
  })

  it('clamps a value to its limits rather than accepting it', () => {
    const tiny = normalizeContext({ ...DEFAULT_CONTEXT, windowChars: 10, debounceMs: 1 })
    expect(tiny.windowChars).toBe(200)
    expect(tiny.debounceMs).toBe(250)

    const huge = normalizeContext({ ...DEFAULT_CONTEXT, windowChars: 99_999 })
    expect(huge.windowChars).toBe(8000)
  })

  it('keeps the default for a field that is missing or not a number', () => {
    const bad = { ...DEFAULT_CONTEXT, rankerChars: Number.NaN, sfxChars: 'x' } as never
    const out = normalizeContext(bad)
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
})
