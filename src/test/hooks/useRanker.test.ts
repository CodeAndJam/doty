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

  it('leaves the model unloaded until a recommendation asks for it', async () => {
    const rankerDecide = vi.fn<() => Promise<number[]>>().mockResolvedValue([])
    const rankerStatus = vi.fn().mockResolvedValue({ cached: true, downloading: false, languageCovered: true })
    const unsub = vi.fn()
    Object.defineProperty(window, 'doty', {
      configurable: true,
      value: {
        onRankerStatus: vi.fn(() => unsub),
        onRankerDownloadProgress: vi.fn(() => unsub),
        rankerStatus,
        rankerDecide,
      },
    })

    const { unmount } = renderHook(() => useRanker())
    expect(rankerDecide).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    // No idle warmup: a session with no ranking never initialises ONNX.
    expect(rankerDecide).not.toHaveBeenCalled()

    unmount()
    expect(unsub).toHaveBeenCalled()
  })
})
