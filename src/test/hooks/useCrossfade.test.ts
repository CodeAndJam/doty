import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCrossfade } from '../../hooks/useCrossfade'

describe('useCrossfade', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('initializes with default 800ms', () => {
    const { result } = renderHook(() => useCrossfade())
    expect(result.current.crossfadeMs).toBe(800)
  })

  it('restores value from localStorage', () => {
    localStorage.setItem('doty:crossfadeMs', '2000')
    const { result } = renderHook(() => useCrossfade())
    expect(result.current.crossfadeMs).toBe(2000)
  })

  it('setCrossfadeMs updates and persists', () => {
    const { result } = renderHook(() => useCrossfade())

    act(() => result.current.setCrossfadeMs(1500))
    expect(result.current.crossfadeMs).toBe(1500)
    expect(localStorage.getItem('doty:crossfadeMs')).toBe('1500')
  })

  it('clamps to 0 minimum', () => {
    const { result } = renderHook(() => useCrossfade())

    act(() => result.current.setCrossfadeMs(-100))
    expect(result.current.crossfadeMs).toBe(0)
    expect(localStorage.getItem('doty:crossfadeMs')).toBe('0')
  })

  it('clamps to 5000 maximum', () => {
    const { result } = renderHook(() => useCrossfade())

    act(() => result.current.setCrossfadeMs(9999))
    expect(result.current.crossfadeMs).toBe(5000)
    expect(localStorage.getItem('doty:crossfadeMs')).toBe('5000')
  })

  it('rounds fractional values', () => {
    const { result } = renderHook(() => useCrossfade())

    act(() => result.current.setCrossfadeMs(1234.7))
    expect(result.current.crossfadeMs).toBe(1235)
  })

  it('handles corrupt localStorage gracefully', () => {
    localStorage.setItem('doty:crossfadeMs', 'not-a-number')
    const { result } = renderHook(() => useCrossfade())
    expect(result.current.crossfadeMs).toBe(800)
  })

  it('handles out-of-range localStorage value', () => {
    localStorage.setItem('doty:crossfadeMs', '99999')
    const { result } = renderHook(() => useCrossfade())
    expect(result.current.crossfadeMs).toBe(800)
  })

  it('allows 0 for instant transitions', () => {
    const { result } = renderHook(() => useCrossfade())

    act(() => result.current.setCrossfadeMs(0))
    expect(result.current.crossfadeMs).toBe(0)
    expect(localStorage.getItem('doty:crossfadeMs')).toBe('0')
  })
})
