import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Debounce interim text', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('batches rapid interim updates into one via 300ms debounce', () => {
    const setInterimText = vi.fn()
    let debounceRef: ReturnType<typeof setTimeout> | null = null

    // Simulate the debounced handler logic from MainLayout
    function handleInterim(text: string) {
      if (debounceRef) clearTimeout(debounceRef)
      debounceRef = setTimeout(() => setInterimText(text), 300)
    }

    handleInterim('H')
    handleInterim('He')
    handleInterim('Hel')
    handleInterim('Hell')
    handleInterim('Hello')

    // Before 300ms, nothing should have been called
    expect(setInterimText).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    expect(setInterimText).toHaveBeenCalledOnce()
    expect(setInterimText).toHaveBeenCalledWith('Hello')
  })

  it('calls immediately after debounce period', () => {
    const setInterimText = vi.fn()
    let debounceRef: ReturnType<typeof setTimeout> | null = null

    function handleInterim(text: string) {
      if (debounceRef) clearTimeout(debounceRef)
      debounceRef = setTimeout(() => setInterimText(text), 300)
    }

    handleInterim('first')
    vi.advanceTimersByTime(300)
    expect(setInterimText).toHaveBeenCalledWith('first')

    handleInterim('second')
    vi.advanceTimersByTime(300)
    expect(setInterimText).toHaveBeenCalledWith('second')
    expect(setInterimText).toHaveBeenCalledTimes(2)
  })
})
