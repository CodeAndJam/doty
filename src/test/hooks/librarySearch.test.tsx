import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { playablePath, type SearchHit, useLibrarySearch } from '../../hooks/useLibrarySearch'

function hit(path: string, origin: 'music' | 'sfx' = 'music'): SearchHit {
  return { key: path, path, lane: origin, absolute: `/abs/${path}`, origin }
}

function stubDoty(search: (text: string) => Promise<{ mode: 'semantic' | 'text'; items: SearchHit[] }>) {
  const noop = () => () => {}
  ;(globalThis as unknown as { window: Window }).window.doty = {
    librarySearch: vi.fn(search),
    embeddingStatus: vi.fn().mockResolvedValue(null),
    onEmbeddingProgress: noop,
    onScanComplete: noop,
    onSfxChanged: noop,
  } as never
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useLibrarySearch', () => {
  it('starts empty and stays empty for a blank query', () => {
    stubDoty(async () => ({ mode: 'text', items: [] }))
    const { result } = renderHook(() => useLibrarySearch('   ', 'music'))
    expect(result.current).toBeNull()
  })

  it('debounces one answer per settled query', async () => {
    const search = vi.fn(async () => ({ mode: 'semantic' as const, items: [hit('tavern.mp3')] }))
    stubDoty(search)
    const { result } = renderHook(() => useLibrarySearch('tavern', 'music'))
    await waitFor(() => expect(result.current?.hits).toHaveLength(1))
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('tavern', 'music', 50)
  })

  it('never lets an abandoned answer overwrite a newer one', async () => {
    const resolvers: Array<(v: { mode: 'text'; items: SearchHit[] }) => void> = []
    stubDoty(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve)
        }),
    )
    const { result, rerender } = renderHook(({ q }) => useLibrarySearch(q, 'music'), {
      initialProps: { q: 'ta' },
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300))
    })
    rerender({ q: 'tavern' })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300))
    })
    expect(resolvers).toHaveLength(2)
    // The newer query answers, then the abandoned one arrives late.
    await act(async () => {
      resolvers[1]?.({ mode: 'text', items: [hit('new.mp3')] })
    })
    await act(async () => {
      resolvers[0]?.({ mode: 'text', items: [hit('old.mp3')] })
    })
    expect(result.current?.hits[0]?.path).toBe('new.mp3')
  })

  it('keeps the previous answer while the next query is in flight', async () => {
    stubDoty(async () => ({ mode: 'text' as const, items: [hit('first.mp3')] }))
    const { result, rerender } = renderHook(({ q }) => useLibrarySearch(q, 'music'), { initialProps: { q: 'a' } })
    await waitFor(() => expect(result.current?.hits).toHaveLength(1))
    rerender({ q: 'ab' })
    // Still the old answer: an empty list here would read as "no matches".
    expect(result.current?.hits).toHaveLength(1)
  })

  it('clears when the box is emptied', async () => {
    stubDoty(async () => ({ mode: 'text' as const, items: [hit('first.mp3')] }))
    const { result, rerender } = renderHook(({ q }) => useLibrarySearch(q, 'music'), { initialProps: { q: 'a' } })
    await waitFor(() => expect(result.current).not.toBeNull())
    rerender({ q: '' })
    await waitFor(() => expect(result.current).toBeNull())
  })
})

describe('playablePath', () => {
  it('plays a music-folder file by relative path and anything else absolutely', () => {
    expect(playablePath(hit('Tavern/tavern.mp3', 'music'))).toBe('Tavern/tavern.mp3')
    expect(playablePath(hit('Door/slam.wav', 'sfx'))).toBe('/abs/Door/slam.wav')
  })
})
