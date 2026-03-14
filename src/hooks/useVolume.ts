import { useCallback, useState } from 'react'

const VOLUME_KEY = 'doty:volume'
const MUTED_KEY = 'doty:muted'

function loadVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '1')
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1
  } catch {
    return 1
  }
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === 'true'
  } catch {
    return false
  }
}

export interface UseVolumeReturn {
  volume: number
  muted: boolean
  setVolume: (v: number) => void
  toggleMute: () => void
  /** Effective volume (0 if muted, otherwise volume). Use this to set audio element volume. */
  effectiveVolume: number
}

export function useVolume(): UseVolumeReturn {
  const [volume, setVolumeState] = useState(loadVolume)
  const [muted, setMuted] = useState(loadMuted)

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    setVolumeState(clamped)
    try {
      localStorage.setItem(VOLUME_KEY, String(clamped))
    } catch {}
  }, [])

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev
      try {
        localStorage.setItem(MUTED_KEY, String(next))
      } catch {}
      return next
    })
  }, [])

  return {
    volume,
    muted,
    setVolume,
    toggleMute,
    effectiveVolume: muted ? 0 : volume,
  }
}
