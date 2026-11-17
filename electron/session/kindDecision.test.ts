import { describe, expect, it } from 'vitest'
import {
  decideKind,
  decideKindFor,
  disambiguate,
  KIND_QUERIES,
  type KindAnchors,
  kindScores,
  moveDestination,
} from './kindDecision'

const unit = (values: number[]) => {
  const length = Math.hypot(...values)
  return Float32Array.from(values, (v) => v / length)
}

describe('decideKindFor', () => {
  // Orthogonal anchors make the score arithmetic visible: a vector on an axis
  // reaches its own anchor at 1 and the other at 0.
  const anchors: KindAnchors = { music: unit([1, 0, 0]), sfx: unit([0, 1, 0]) }

  it('scores a track against both descriptions', () => {
    const scores = kindScores(unit([0.8, 0.2, 0]), anchors)
    expect(scores.music).toBeGreaterThan(scores.sfx)
    expect(scores.music).toBeCloseTo(0.8 / Math.hypot(0.8, 0.2), 4)
  })

  it('decides a clear music vector as music', () => {
    expect(decideKindFor(unit([1, 0.1, 0]), anchors).kind).toBe('music')
  })

  it('decides a clear effect vector as an effect', () => {
    expect(decideKindFor(unit([0.1, 1, 0]), anchors).kind).toBe('sfx')
  })

  it('decides a near tie as music rather than refusing', () => {
    expect(decideKindFor(unit([1, 1, 0]), anchors).kind).toBe('music')
  })

  it('refuses a vector from another space instead of scoring it', () => {
    const wrong = decideKindFor(new Float32Array(4), anchors)
    expect(wrong.kind).toBe('uncertain')
    expect(wrong.reason).toMatch(/not comparable/)
  })

  it('refuses a zero vector, where every cosine is meaningless', () => {
    expect(decideKindFor(new Float32Array(3), { music: new Float32Array(3), sfx: new Float32Array(3) }).kind).toBe(
      'uncertain',
    )
  })
})

describe('decideKind', () => {
  it('calls something nearer a cue music', () => {
    const d = decideKind(0.62, 0.4)
    expect(d.kind).toBe('music')
    expect(d.reason).toMatch(/cue/)
  })

  it('calls something nearer an effect an effect', () => {
    expect(decideKind(0.3, 0.55).kind).toBe('sfx')
  })

  it('decides a near tie as music, and a clear effect as an effect', () => {
    // The music side is the default: only a nearer effect description moves it.
    expect(decideKind(0.5, 0.5).kind).toBe('music')
    expect(decideKind(0.5, 0.51).kind).toBe('sfx')
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
