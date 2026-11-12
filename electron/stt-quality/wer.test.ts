import { describe, expect, it } from 'vitest'
import { charErrorRate, percentile, tokenize, wordErrorRate } from './wer'

describe('tokenize', () => {
  it('keeps Portuguese accents and drops punctuation/case', () => {
    expect(tokenize('Vocês chegaram, não é? — Sim!')).toEqual(['vocês', 'chegaram', 'não', 'é', 'sim'])
  })

  it('normalizes unicode forms', () => {
    // NFKC folds the combining acute into the precomposed form.
    expect(tokenize('e\u0301')).toEqual(tokenize('é'))
  })
})

describe('wordErrorRate', () => {
  it('is 0 for an exact match, ignoring punctuation and case', () => {
    expect(wordErrorRate('Um gato e um rato.', 'um GATO e um rato').rate).toBe(0)
  })

  it('counts substitutions, deletions and insertions', () => {
    const r = wordErrorRate('a b c d', 'a x c')
    expect(r.substitutions).toBe(1)
    expect(r.deletions).toBe(1)
    expect(r.insertions).toBe(0)
    expect(r.rate).toBe(0.5)
  })

  it('counts insertions against the reference length', () => {
    const r = wordErrorRate('a b', 'a b c d')
    expect(r.insertions).toBe(2)
    expect(r.rate).toBe(1)
  })

  it('treats any output on an empty reference as a hallucination', () => {
    expect(wordErrorRate('', '').rate).toBe(0)
    expect(wordErrorRate('', 'obrigado').rate).toBe(1)
    expect(wordErrorRate('', 'obrigado').insertions).toBe(1)
  })
})

describe('charErrorRate', () => {
  it('is stricter than WER for small spelling errors', () => {
    const ref = 'Ele afunila criando uma altura'
    const hyp = 'Ele a funila criando uma altura'
    expect(wordErrorRate(ref, hyp).rate).toBeGreaterThan(0)
    expect(charErrorRate(ref, hyp).rate).toBeGreaterThan(0)
    expect(charErrorRate(ref, hyp).rate).toBeLessThan(wordErrorRate(ref, hyp).rate)
  })
})

describe('percentile', () => {
  it('returns the p50 and p95 of a sample', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3)
    expect(percentile([1, 2, 3, 4, 5], 95)).toBe(5)
  })

  it('handles empty input', () => {
    expect(percentile([], 95)).toBe(0)
  })
})
