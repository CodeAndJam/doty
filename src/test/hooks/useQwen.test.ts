import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useQwen } from '../../hooks/useQwen'

describe('useQwen reranker warmup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('defers the reranker load instead of warming it at mount', async () => {
    const rerankerScore = vi.fn<() => Promise<number[]>>().mockResolvedValue([1])
    const unsub = vi.fn()
    Object.defineProperty(window, 'doty', {
      configurable: true,
      value: {
        onRerankerStatus: vi.fn(() => unsub),
        onRerankerDownloadProgress: vi.fn(() => unsub),
        rerankerScore,
      },
    })

    const { unmount } = renderHook(() => useQwen())
    expect(rerankerScore).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(rerankerScore).toHaveBeenCalledTimes(1)

    unmount()
    expect(unsub).toHaveBeenCalled()
  })
})
