import { describe, expect, it } from 'vitest'
import { cosine, meanPool, normalise, topK } from './embedding'

describe('meanPool', () => {
  it('averages only the tokens the mask keeps', () => {
    // Two tokens of width 2, the second masked out.
    const hidden = [1, 2, 99, 99]
    expect(Array.from(meanPool(hidden, [1, 0], 2))).toEqual([1, 2])
  })

  it('averages across every kept token', () => {
    const hidden = [1, 3, 5, 7] // two tokens: [1,3] and [5,7]
    expect(Array.from(meanPool(hidden, [1, 1], 2))).toEqual([3, 5])
  })

  it('never divides by zero when nothing is kept', () => {
    expect(Array.from(meanPool([9, 9], [0], 2))).toEqual([0, 0])
  })
})

describe('normalise', () => {
  it('gives a unit vector', () => {
    const v = normalise(Float32Array.from([3, 4]))
    expect(v[0]).toBeCloseTo(0.6, 6)
    expect(v[1]).toBeCloseTo(0.8, 6)
  })

  it('leaves a zero vector alone instead of producing NaNs', () => {
    expect(Array.from(normalise(Float32Array.from([0, 0])))).toEqual([0, 0])
  })
})

describe('cosine', () => {
  it('is 1 for the same direction, 0 for orthogonal, -1 for opposite', () => {
    const a = Float32Array.from([1, 0])
    expect(cosine(a, a)).toBeCloseTo(1, 6)
    expect(cosine(a, Float32Array.from([0, 1]))).toBeCloseTo(0, 6)
    expect(cosine(a, Float32Array.from([-1, 0]))).toBeCloseTo(-1, 6)
  })

  it('is 0 rather than NaN for a zero vector', () => {
    expect(cosine(Float32Array.from([0, 0]), Float32Array.from([1, 1]))).toBe(0)
  })
})

describe('topK', () => {
  it('returns the best matches, best first', () => {
    const query = Float32Array.from([1, 0])
    const vectors = new Map([
      ['far', Float32Array.from([0, 1])],
      ['near', Float32Array.from([1, 0.1])],
      ['mid', Float32Array.from([1, 1])],
    ])
    expect(topK(query, vectors, 2)).toEqual(['near', 'mid'])
  })

  it('returns everything when k exceeds the library', () => {
    const query = Float32Array.from([1, 0])
    const vectors = new Map([['only', Float32Array.from([1, 0])]])
    expect(topK(query, vectors, 10)).toEqual(['only'])
  })

  it('is empty for an empty library', () => {
    expect(topK(Float32Array.from([1, 0]), new Map(), 5)).toEqual([])
  })
})
