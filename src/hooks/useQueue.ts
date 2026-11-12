import { useCallback, useState } from 'react'

export interface UseQueueReturn {
  /** Ordered list of queued track filenames */
  tracks: string[]
  /** Index of the currently active track (-1 if empty) */
  currentIndex: number
  /** Add a track to the end of the queue */
  enqueue: (filename: string) => void
  /** Insert a track right after the current one ("Play Next") */
  playNext: (filename: string) => void
  /** Remove a track by index */
  remove: (index: number) => void
  /** Clear the entire queue */
  clear: () => void
  /** Move a track from one index to another (drag-to-reorder) */
  reorder: (fromIndex: number, toIndex: number) => void
  /** Set the current index (e.g. when jumping to a track) */
  setCurrentIndex: (index: number) => void
  /** Advance to next track. Wraps if wrap=true. Returns the new current track or null. */
  next: (wrap?: boolean) => string | null
  /** Go to previous track. Wraps if wrap=true. Returns the new current track or null. */
  prev: (wrap?: boolean) => string | null
  /** Replace the entire queue and reset index */
  setQueue: (tracks: string[], startIndex?: number) => void
  /** Current track filename or null */
  currentTrack: string | null
}

export function useQueue(): UseQueueReturn {
  const [tracks, setTracks] = useState<string[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)

  const enqueue = useCallback((filename: string) => {
    setTracks((prev) => [...prev, filename])
    // If queue was empty, point to the new track
    setCurrentIndex((prev) => (prev === -1 ? 0 : prev))
  }, [])

  const playNext = useCallback(
    (filename: string) => {
      setTracks((prev) => {
        const insertAt = currentIndex + 1
        const next = [...prev]
        next.splice(insertAt, 0, filename)
        return next
      })
      setCurrentIndex((prev) => (prev === -1 ? 0 : prev))
    },
    [currentIndex],
  )

  const remove = useCallback(
    (index: number) => {
      if (index < 0 || index >= tracks.length) return
      const next = tracks.filter((_, i) => i !== index)
      setTracks(next)
      setCurrentIndex((ci) => {
        if (next.length === 0) return -1
        if (index < ci) return ci - 1
        if (index === ci) return Math.min(ci, next.length - 1)
        return ci
      })
    },
    [tracks],
  )

  const clear = useCallback(() => {
    setTracks([])
    setCurrentIndex(-1)
  }, [])

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setTracks((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length) return prev
      if (toIndex < 0 || toIndex >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
    setCurrentIndex((prev) => {
      // Adjust current index to follow the currently playing track
      if (prev === fromIndex) return toIndex
      if (fromIndex < prev && toIndex >= prev) return prev - 1
      if (fromIndex > prev && toIndex <= prev) return prev + 1
      return prev
    })
  }, [])

  const next = useCallback(
    (wrap = false): string | null => {
      if (tracks.length === 0) return null
      const newIndex = currentIndex + 1 < tracks.length ? currentIndex + 1 : wrap ? 0 : currentIndex
      setCurrentIndex(newIndex)
      return newIndex >= 0 && newIndex < tracks.length ? tracks[newIndex] : null
    },
    [tracks, currentIndex],
  )

  const prev = useCallback(
    (wrap = false): string | null => {
      if (tracks.length === 0) return null
      const newIndex = currentIndex - 1 >= 0 ? currentIndex - 1 : wrap ? tracks.length - 1 : currentIndex
      setCurrentIndex(newIndex)
      return newIndex >= 0 && newIndex < tracks.length ? tracks[newIndex] : null
    },
    [tracks, currentIndex],
  )

  const setQueue = useCallback((newTracks: string[], startIndex = 0) => {
    setTracks(newTracks)
    setCurrentIndex(newTracks.length > 0 ? Math.min(startIndex, newTracks.length - 1) : -1)
  }, [])

  return {
    tracks,
    currentIndex,
    enqueue,
    playNext,
    remove,
    clear,
    reorder,
    setCurrentIndex,
    next,
    prev,
    setQueue,
    currentTrack: currentIndex >= 0 && currentIndex < tracks.length ? tracks[currentIndex] : null,
  }
}
