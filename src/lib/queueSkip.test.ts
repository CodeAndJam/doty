import { describe, expect, it } from 'vitest'
import { skipTarget } from './queueSkip'

describe('skipTarget', () => {
  it('moves one row and stops at the edge without wrapping', () => {
    expect(skipTarget(0, 3, 1, false)).toBe(1)
    expect(skipTarget(2, 3, 1, false)).toBe(-1)
    expect(skipTarget(1, 3, -1, false)).toBe(0)
    expect(skipTarget(0, 3, -1, false)).toBe(-1)
  })

  it('wraps only when the queue is looping', () => {
    expect(skipTarget(2, 3, 1, true)).toBe(0)
    expect(skipTarget(0, 3, -1, true)).toBe(2)
  })

  it('starts the head from outside the queue, and has no previous row', () => {
    expect(skipTarget(-1, 3, 1, false)).toBe(0)
    expect(skipTarget(-1, 3, -1, false)).toBe(-1)
    expect(skipTarget(-1, 3, -1, true)).toBe(2)
  })

  it('does nothing on an empty queue', () => {
    expect(skipTarget(-1, 0, 1, true)).toBe(-1)
  })
})
