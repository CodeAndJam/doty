import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useVolume } from '../../hooks/useVolume'

describe('useVolume', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('initializes with default volume 1 and unmuted', () => {
    const { result } = renderHook(() => useVolume())
    expect(result.current.volume).toBe(1)
    expect(result.current.muted).toBe(false)
    expect(result.current.effectiveVolume).toBe(1)
  })

  it('restores volume from localStorage', () => {
    localStorage.setItem('doty:volume', '0.5')
    const { result } = renderHook(() => useVolume())
    expect(result.current.volume).toBe(0.5)
  })

  it('restores muted state from localStorage', () => {
    localStorage.setItem('doty:muted', 'true')
    const { result } = renderHook(() => useVolume())
    expect(result.current.muted).toBe(true)
    expect(result.current.effectiveVolume).toBe(0)
  })

  it('setVolume clamps to 0..1 and persists', () => {
    const { result } = renderHook(() => useVolume())

    act(() => result.current.setVolume(0.7))
    expect(result.current.volume).toBe(0.7)
    expect(localStorage.getItem('doty:volume')).toBe('0.7')

    act(() => result.current.setVolume(-0.5))
    expect(result.current.volume).toBe(0)

    act(() => result.current.setVolume(1.5))
    expect(result.current.volume).toBe(1)
  })

  it('toggleMute flips muted state and persists', () => {
    const { result } = renderHook(() => useVolume())

    act(() => result.current.toggleMute())
    expect(result.current.muted).toBe(true)
    expect(result.current.effectiveVolume).toBe(0)
    expect(localStorage.getItem('doty:muted')).toBe('true')

    act(() => result.current.toggleMute())
    expect(result.current.muted).toBe(false)
    expect(result.current.effectiveVolume).toBe(1)
    expect(localStorage.getItem('doty:muted')).toBe('false')
  })

  it('effectiveVolume is 0 when muted regardless of volume', () => {
    localStorage.setItem('doty:volume', '0.8')
    localStorage.setItem('doty:muted', 'true')
    const { result } = renderHook(() => useVolume())
    expect(result.current.volume).toBe(0.8)
    expect(result.current.effectiveVolume).toBe(0)
  })

  it('handles corrupt localStorage gracefully', () => {
    localStorage.setItem('doty:volume', 'not-a-number')
    localStorage.setItem('doty:muted', 'garbage')
    const { result } = renderHook(() => useVolume())
    expect(result.current.volume).toBe(1)
    expect(result.current.muted).toBe(false)
  })
})
