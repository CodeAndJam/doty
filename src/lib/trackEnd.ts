import type { LoopMode } from '../types'

export type { LoopMode }

export interface TrackEndInput {
  tracks: string[]
  currentIndex: number
  /** The file actually loaded in the player, which need not be in the queue. */
  playing: string | null
  loopMode: LoopMode
}

export interface TrackEndPlan {
  track: string
  /** Row to select, or null when the same row repeats. */
  index: number | null
}

/**
 * What plays when the current track ends. A queued next cue wins even in single
 * mode; "single" only repeats when there is nothing lined up after this row.
 * With no queue at all, single repeats the file the DM is hearing.
 */
export function trackEndPlan({ tracks, currentIndex, playing, loopMode }: TrackEndInput): TrackEndPlan | null {
  if (tracks.length === 0) {
    if (loopMode === 'single' && playing) return { track: playing, index: null }
    return null
  }

  const hasNext = currentIndex + 1 < tracks.length
  if (hasNext) {
    const index = currentIndex + 1
    return { track: tracks[index], index }
  }
  if (loopMode === 'queue') return { track: tracks[0], index: 0 }
  if (loopMode === 'single' && currentIndex >= 0) {
    return { track: tracks[currentIndex], index: currentIndex }
  }
  return null
}
