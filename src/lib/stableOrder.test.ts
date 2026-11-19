import { describe, expect, it } from 'vitest'
import { stableOrder } from './stableOrder'

const p = (values: Record<string, number>) => values

describe('stableOrder', () => {
  it('keeps the shelf when the top has not changed', () => {
    expect(stableOrder(['a', 'b', 'c'], p({ a: 0.4, b: 0.3 }), 'a')).toEqual(['a', 'b', 'c'])
  })

  it('does not flip on a small probability shift', () => {
    expect(stableOrder(['b', 'a', 'c'], p({ b: 0.45, a: 0.4, c: 0.1 }), 'a')).toEqual(['a', 'b', 'c'])
  })

  it('accepts a clearly better pick', () => {
    expect(stableOrder(['b', 'a', 'c'], p({ b: 0.7, a: 0.4, c: 0.1 }), 'a')).toEqual(['b', 'a', 'c'])
  })

  it('follows the model when the held pick is no longer offered', () => {
    expect(stableOrder(['b', 'c'], p({ b: 0.6, c: 0.3 }), 'a')).toEqual(['b', 'c'])
  })

  it('leaves keyword answers alone: there are no probabilities to compare', () => {
    expect(stableOrder(['b', 'a'], {}, 'a')).toEqual(['b', 'a'])
  })
})
