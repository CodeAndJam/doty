import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useQueue } from '../../hooks/useQueue'

describe('useQueue', () => {
  it('starts with empty queue', () => {
    const { result } = renderHook(() => useQueue())
    expect(result.current.tracks).toEqual([])
    expect(result.current.currentIndex).toBe(-1)
    expect(result.current.currentTrack).toBeNull()
  })

  describe('enqueue', () => {
    it('adds a track and sets index to 0 if queue was empty', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.enqueue('track1.mp3'))
      expect(result.current.tracks).toEqual(['track1.mp3'])
      expect(result.current.currentIndex).toBe(0)
      expect(result.current.currentTrack).toBe('track1.mp3')
    })

    it('appends to end without changing current index', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.enqueue('track1.mp3'))
      act(() => result.current.enqueue('track2.mp3'))
      act(() => result.current.enqueue('track3.mp3'))
      expect(result.current.tracks).toEqual(['track1.mp3', 'track2.mp3', 'track3.mp3'])
      expect(result.current.currentIndex).toBe(0)
    })
  })

  describe('playNext', () => {
    it('inserts after current track', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'c.mp3'], 0))
      act(() => result.current.playNext('b.mp3'))
      expect(result.current.tracks).toEqual(['a.mp3', 'b.mp3', 'c.mp3'])
      expect(result.current.currentIndex).toBe(0)
    })

    it('works on empty queue', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.playNext('a.mp3'))
      expect(result.current.tracks).toEqual(['a.mp3'])
      expect(result.current.currentIndex).toBe(0)
    })
  })

  describe('remove', () => {
    it('removes a track by index', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3', 'c.mp3'], 1))
      act(() => result.current.remove(2))
      expect(result.current.tracks).toEqual(['a.mp3', 'b.mp3'])
      expect(result.current.currentIndex).toBe(1)
    })

    it('adjusts current index when removing before it', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3', 'c.mp3'], 2))
      act(() => result.current.remove(0))
      expect(result.current.tracks).toEqual(['b.mp3', 'c.mp3'])
      expect(result.current.currentIndex).toBe(1)
    })

    it('ignores out-of-bounds index', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3'], 0))
      act(() => result.current.remove(5))
      expect(result.current.tracks).toEqual(['a.mp3'])
    })

    it('clamps currentIndex when removing last item at current position', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3', 'c.mp3'], 2))
      act(() => result.current.remove(2))
      expect(result.current.tracks).toEqual(['a.mp3', 'b.mp3'])
      expect(result.current.currentIndex).toBe(1) // clamped to last valid index
    })

    it('resets to -1 when removing the only track', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3'], 0))
      act(() => result.current.remove(0))
      expect(result.current.tracks).toEqual([])
      expect(result.current.currentIndex).toBe(-1)
      expect(result.current.currentTrack).toBeNull()
    })

    it('keeps currentIndex stable when removing after it', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3', 'c.mp3'], 0))
      act(() => result.current.remove(2))
      expect(result.current.tracks).toEqual(['a.mp3', 'b.mp3'])
      expect(result.current.currentIndex).toBe(0)
    })
  })

  describe('clear', () => {
    it('empties the queue and resets index', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3'], 1))
      act(() => result.current.clear())
      expect(result.current.tracks).toEqual([])
      expect(result.current.currentIndex).toBe(-1)
      expect(result.current.currentTrack).toBeNull()
    })
  })

  describe('reorder', () => {
    it('moves a track from one position to another', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3', 'c.mp3'], 0))
      act(() => result.current.reorder(0, 2))
      expect(result.current.tracks).toEqual(['b.mp3', 'c.mp3', 'a.mp3'])
      // Current index follows the moved track
      expect(result.current.currentIndex).toBe(2)
    })

    it('adjusts index when reordering around current', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3', 'c.mp3'], 1))
      // Move last track before current
      act(() => result.current.reorder(2, 0))
      expect(result.current.tracks).toEqual(['c.mp3', 'a.mp3', 'b.mp3'])
      expect(result.current.currentIndex).toBe(2)
    })

    it('ignores invalid indices', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3'], 0))
      act(() => result.current.reorder(-1, 0))
      expect(result.current.tracks).toEqual(['a.mp3'])
      act(() => result.current.reorder(0, 5))
      expect(result.current.tracks).toEqual(['a.mp3'])
    })
  })

  describe('next', () => {
    it('advances to next track', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3', 'c.mp3'], 0))
      act(() => result.current.next())
      expect(result.current.currentIndex).toBe(1)
      expect(result.current.currentTrack).toBe('b.mp3')
    })

    it('stays at end without wrap', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3'], 1))
      act(() => result.current.next(false))
      expect(result.current.currentIndex).toBe(1)
    })

    it('wraps to start when wrap=true', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3'], 1))
      act(() => result.current.next(true))
      expect(result.current.currentIndex).toBe(0)
      expect(result.current.currentTrack).toBe('a.mp3')
    })

    it('handles empty queue', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.next(true))
      expect(result.current.currentIndex).toBe(-1)
    })
  })

  describe('prev', () => {
    it('goes to previous track', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3', 'c.mp3'], 2))
      act(() => result.current.prev())
      expect(result.current.currentIndex).toBe(1)
      expect(result.current.currentTrack).toBe('b.mp3')
    })

    it('stays at start without wrap', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3'], 0))
      act(() => result.current.prev(false))
      expect(result.current.currentIndex).toBe(0)
    })

    it('wraps to end when wrap=true', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3'], 0))
      act(() => result.current.prev(true))
      expect(result.current.currentIndex).toBe(1)
      expect(result.current.currentTrack).toBe('b.mp3')
    })
  })

  describe('setQueue', () => {
    it('replaces queue and sets start index', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['x.mp3', 'y.mp3'], 1))
      expect(result.current.tracks).toEqual(['x.mp3', 'y.mp3'])
      expect(result.current.currentIndex).toBe(1)
      expect(result.current.currentTrack).toBe('y.mp3')
    })

    it('clamps start index to queue length', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3'], 10))
      expect(result.current.currentIndex).toBe(0)
    })

    it('sets index to -1 for empty queue', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue([]))
      expect(result.current.currentIndex).toBe(-1)
    })
  })

  // ── Queue loop scenarios (simulating loop mode = "queue") ──────────

  describe('queue loop (next with wrap=true)', () => {
    it('wraps from last track back to first on next', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3', 'c.mp3'], 2))
      expect(result.current.currentTrack).toBe('c.mp3')
      act(() => result.current.next(true))
      expect(result.current.currentIndex).toBe(0)
      expect(result.current.currentTrack).toBe('a.mp3')
    })

    it('wraps from first track back to last on prev', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3', 'c.mp3'], 0))
      expect(result.current.currentTrack).toBe('a.mp3')
      act(() => result.current.prev(true))
      expect(result.current.currentIndex).toBe(2)
      expect(result.current.currentTrack).toBe('c.mp3')
    })

    it('cycles through entire queue with repeated next(true)', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3', 'c.mp3'], 0))
      act(() => result.current.next(true)) // -> b
      act(() => result.current.next(true)) // -> c
      act(() => result.current.next(true)) // -> a (wrap)
      expect(result.current.currentIndex).toBe(0)
      expect(result.current.currentTrack).toBe('a.mp3')
      act(() => result.current.next(true)) // -> b
      expect(result.current.currentIndex).toBe(1)
      expect(result.current.currentTrack).toBe('b.mp3')
    })

    it('single-track queue wraps to itself', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['only.mp3'], 0))
      act(() => result.current.next(true))
      expect(result.current.currentIndex).toBe(0)
      expect(result.current.currentTrack).toBe('only.mp3')
    })
  })

  // ── No-loop scenarios (simulating loop mode = "off") ───────────────

  describe('no loop (next/prev with wrap=false)', () => {
    it('stays at last track on next without wrap', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3', 'c.mp3'], 2))
      act(() => result.current.next(false))
      expect(result.current.currentIndex).toBe(2)
      expect(result.current.currentTrack).toBe('c.mp3')
    })

    it('stays at first track on prev without wrap', () => {
      const { result } = renderHook(() => useQueue())
      act(() => result.current.setQueue(['a.mp3', 'b.mp3', 'c.mp3'], 0))
      act(() => result.current.prev(false))
      expect(result.current.currentIndex).toBe(0)
      expect(result.current.currentTrack).toBe('a.mp3')
    })
  })
})
