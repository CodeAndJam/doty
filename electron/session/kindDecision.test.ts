import { describe, expect, it } from 'vitest'
import { decideKind, disambiguate, KIND_MARGIN, KIND_QUERIES, moveDestination } from './kindDecision'

describe('decideKind', () => {
  it('calls something nearer a cue music', () => {
    const d = decideKind(0.62, 0.4)
    expect(d.kind).toBe('music')
    expect(d.reason).toMatch(/cue/)
  })

  it('calls something nearer an effect an effect', () => {
    expect(decideKind(0.3, 0.55).kind).toBe('sfx')
  })

  it('refuses to move a track it cannot tell apart', () => {
    // Silence beats a confident wrong move: the file keeps its place.
    expect(decideKind(0.5, 0.5 + KIND_MARGIN / 2).kind).toBe('uncertain')
  })

  it('treats a missing embedding as uncertain rather than guessing', () => {
    expect(decideKind(Number.NaN, 0.4).kind).toBe('uncertain')
  })

  it('asks both questions of the same shared space', () => {
    expect(KIND_QUERIES.music).toMatch(/music/i)
    expect(KIND_QUERIES.sfx).toMatch(/sound effect/i)
  })
})

describe('moveDestination', () => {
  it('puts the file under the target folder', () => {
    expect(moveDestination('roar.wav', 'sfx', { music: '/lib/Music', sfx: '/lib/Effects' })).toBe(
      '/lib/Effects/roar.wav',
    )
  })

  it('tolerates a trailing separator', () => {
    expect(moveDestination('theme.mp3', 'music', { music: '/lib/Music/', sfx: '/lib/Effects' })).toBe(
      '/lib/Music/theme.mp3',
    )
  })

  it('refuses to invent a path when the target folder is unknown', () => {
    expect(moveDestination('roar.wav', 'sfx', { music: '/lib/Music', sfx: '' })).toBe('')
  })
})

describe('disambiguate', () => {
  it('leaves a free name alone', () => {
    expect(disambiguate('roar.wav', () => false)).toBe('roar.wav')
  })

  it('numbers a collision the way a file manager would', () => {
    const taken = new Set(['roar.wav', 'roar (2).wav'])
    expect(disambiguate('roar.wav', (c) => taken.has(c))).toBe('roar (3).wav')
  })

  it('copes with a name that has no extension', () => {
    expect(disambiguate('roar', (c) => c === 'roar')).toBe('roar (2)')
  })
})
