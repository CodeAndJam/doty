import { describe, expect, it } from 'vitest'
import { ChunkBuffer, FlushTracker, LiveWriter, rms, stablePrefix } from './text-flow'

describe('stablePrefix', () => {
  it('keeps complete sentences and holds back the tail', () => {
    expect(stablePrefix('Vocês chegam a um túnel. Parte da caverna')).toBe('Vocês chegam a um túnel.')
  })

  it('returns nothing while the first sentence is unfinished', () => {
    expect(stablePrefix('Vocês chegam a um')).toBe('')
  })

  it('treats question marks and ellipses as sentence ends', () => {
    expect(stablePrefix('O que é isto?... Não sei')).toBe('O que é isto?...')
  })

  it('handles closing quotes after punctuation', () => {
    expect(stablePrefix('Ele disse "olá." Depois saiu')).toBe('Ele disse "olá."')
  })
})

describe('FlushTracker', () => {
  it('emits each sentence exactly once', () => {
    const t = new FlushTracker()
    expect(t.update('Um gato e um rato.')).toBe('Um gato e um rato.')
    expect(t.update('Um gato e um rato.')).toBe('')
    expect(t.update('Um gato e um rato. Estão a escrever.')).toBe('Estão a escrever.')
  })

  it('does not duplicate text when the model rewrites what was emitted', () => {
    const t = new FlushTracker()
    expect(t.update('Entramos numa dungeon.')).toBe('Entramos numa dungeon.')
    expect(t.update('Entramos em uma dungeon. Depois')).toBe('')
    // A later, longer hypothesis that extends the settled text still appends.
    expect(t.update('Entramos numa dungeon. Depois vemos dragões.')).toBe('Depois vemos dragões.')
  })

  it('commits unfinished text when forced (silence, long speech)', () => {
    const t = new FlushTracker()
    // The trailing word is held back: the model may still be extending it.
    expect(t.update('sem pontuação nenhuma', { force: true })).toBe('sem pontuação')
    expect(t.update('sem pontuação nenhuma mesmo', { force: true })).toBe('nenhuma')
  })

  it('commits the trailing word at finalize', () => {
    const t = new FlushTracker()
    expect(t.update('sem pontuação nenhuma', { final: true })).toBe('sem pontuação nenhuma')
  })

  it('does not emit punctuation-only deltas but still advances', () => {
    const t = new FlushTracker()
    expect(t.update('Frase sem ponto', { force: true })).toBe('Frase sem')
    // Model later adds the final word and the period.
    expect(t.update('Frase sem ponto.', { final: true })).toBe('ponto.')
  })

  it('reset gives a clean session', () => {
    const t = new FlushTracker()
    t.update('Frase completa.')
    t.reset()
    expect(t.settled).toBe('')
    expect(t.update('Outra frase completa.')).toBe('Outra frase completa.')
  })
})

describe('LiveWriter', () => {
  it('emits complete sentences immediately', () => {
    const w = new LiveWriter()
    w.reset(0)
    expect(w.onHypothesis('Uma frase completa.', 500)).toBe('Uma frase completa.')
  })

  it('commits long unpunctuated speech after 4s', () => {
    const w = new LiveWriter()
    w.reset(0)
    const speech = 'O aventureiro caminha pela floresta escura sem parar'
    expect(w.onHypothesis(speech, 3000)).toBe('')
    expect(w.onHypothesis(speech, 4200)).toBe('O aventureiro caminha pela floresta escura sem')
  })

  it('does not force-flush one or two words', () => {
    const w = new LiveWriter()
    w.reset(0)
    expect(w.onHypothesis('Olá', 10_000)).toBe('')
  })

  it('commits the remainder on silence and everything on final', () => {
    const w = new LiveWriter()
    w.reset(0)
    expect(w.onSilence('Frase sem ponto final', 2000)).toBe('Frase sem ponto')
    expect(w.onFinal('Frase sem ponto final')).toBe('final')
  })
})

describe('ChunkBuffer', () => {
  const maxSamples = 16000 * 10

  it('does not cut before the maximum while audio is loud', () => {
    const b = new ChunkBuffer({ maxSamples })
    const loud = new Float32Array(16000).fill(0.2)
    for (let i = 0; i < 5; i++) b.push(loud)
    expect(b.ready()).toBe(false)
    expect(b.pendingSamples).toBe(16000 * 5)
  })

  it('cuts at the maximum', () => {
    const b = new ChunkBuffer({ maxSamples })
    const loud = new Float32Array(16000 * 5).fill(0.2)
    b.push(loud)
    b.push(loud)
    expect(b.ready()).toBe(true)
    const chunk = b.take()
    expect(chunk.length).toBeLessThanOrEqual(maxSamples)
    // Audio past the cut point is kept for the next chunk, never dropped.
    expect(chunk.length + b.pendingSamples).toBe(16000 * 10)
  })

  it('cuts in a quiet window rather than mid-word', () => {
    const b = new ChunkBuffer({ maxSamples: 16000 * 4, minSamples: 16000, searchSamples: 16000 * 2.5 })
    const loud = new Float32Array(16000 * 4).fill(0.2)
    // 200ms of silence starting at 2.5s, inside the search window of the limit.
    loud.fill(0, 16000 * 2.5, 16000 * 2.5 + 3200)
    b.push(loud)
    const chunk = b.take()
    expect(chunk.length).toBeGreaterThan(16000 * 2.4)
    expect(chunk.length).toBeLessThan(16000 * 2.8)
  })

  it('cuts early after a clear pause', () => {
    const b = new ChunkBuffer({ maxSamples })
    b.push(new Float32Array(16000 * 3).fill(0.2))
    expect(b.ready()).toBe(false)
    b.push(new Float32Array(16000 * 2)) // 2s of silence
    expect(b.ready()).toBe(true)
  })

  it('does not cut in silence before the minimum', () => {
    const b = new ChunkBuffer({ maxSamples })
    b.push(new Float32Array(8000))
    expect(b.ready()).toBe(false)
  })
})

describe('rms', () => {
  it('is zero for silence and positive for signal', () => {
    expect(rms(new Float32Array(100))).toBe(0)
    expect(rms(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5)
  })
})
