import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLoop } from '../../hooks/useLoop'

describe('useLoop', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to single loop mode', () => {
    const { result } = renderHook(() => useLoop())
    expect(result.current.loopMode).toBe('single')
  })

  it('restores loop mode from localStorage', () => {
    localStorage.setItem('doty:loopMode', 'queue')
    const { result } = renderHook(() => useLoop())
    expect(result.current.loopMode).toBe('queue')
  })

  it('setLoopMode updates and persists', () => {
    const { result } = renderHook(() => useLoop())

    act(() => result.current.setLoopMode('off'))
    expect(result.current.loopMode).toBe('off')
    expect(localStorage.getItem('doty:loopMode')).toBe('off')

    act(() => result.current.setLoopMode('queue'))
    expect(result.current.loopMode).toBe('queue')
    expect(localStorage.getItem('doty:loopMode')).toBe('queue')
  })

  it('cycleLoopMode cycles off → single → queue → off', () => {
    localStorage.setItem('doty:loopMode', 'off')
    const { result } = renderHook(() => useLoop())

    act(() => result.current.cycleLoopMode())
    expect(result.current.loopMode).toBe('single')

    act(() => result.current.cycleLoopMode())
    expect(result.current.loopMode).toBe('queue')

    act(() => result.current.cycleLoopMode())
    expect(result.current.loopMode).toBe('off')
  })

  it('handles invalid localStorage value gracefully', () => {
    localStorage.setItem('doty:loopMode', 'invalid')
    const { result } = renderHook(() => useLoop())
    expect(result.current.loopMode).toBe('single')
  })
})
