import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRanker } from '../../hooks/useRanker'

describe('useRanker warmup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('defers the model load instead of warming it at mount', async () => {
    const rankerDecide = vi.fn<() => Promise<number[]>>().mockResolvedValue([])
    const rankerStatus = vi.fn().mockResolvedValue({ cached: true, downloading: false, languageCovered: true })
    const unsub = vi.fn()
    Object.defineProperty(window, 'doty', {
      configurable: true,
      value: {
        onRankerStatus: vi.fn(() => unsub),
        rankerStatus,
        rankerDecide,
      },
    })

    const { unmount } = renderHook(() => useRanker())
    expect(rankerDecide).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(rankerDecide).toHaveBeenCalledTimes(1)

    unmount()
    expect(unsub).toHaveBeenCalled()
  })
})
