import { describe, it, expect } from 'vitest'
import { formatTime } from '../../lib/formatTime'

describe('formatTime', () => {
  it('formats zero seconds', () => {
    expect(formatTime(0)).toBe('0:00')
  })

  it('formats seconds under a minute', () => {
    expect(formatTime(5)).toBe('0:05')
    expect(formatTime(59)).toBe('0:59')
  })

  it('formats minutes and seconds', () => {
    expect(formatTime(60)).toBe('1:00')
    expect(formatTime(90)).toBe('1:30')
    expect(formatTime(605)).toBe('10:05')
  })

  it('formats hours', () => {
    expect(formatTime(3600)).toBe('1:00:00')
    expect(formatTime(3661)).toBe('1:01:01')
    expect(formatTime(7325)).toBe('2:02:05')
  })

  it('floors fractional seconds', () => {
    expect(formatTime(1.9)).toBe('0:01')
    expect(formatTime(59.99)).toBe('0:59')
  })

  it('handles negative values', () => {
    expect(formatTime(-1)).toBe('0:00')
    expect(formatTime(-100)).toBe('0:00')
  })

  it('handles NaN and Infinity', () => {
    expect(formatTime(NaN)).toBe('0:00')
    expect(formatTime(Infinity)).toBe('0:00')
    expect(formatTime(-Infinity)).toBe('0:00')
  })
})
