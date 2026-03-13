import { useState, useCallback } from 'react'

const KEY = 'doty:crossfadeMs'
const DEFAULT_MS = 800
const MIN_MS = 0
const MAX_MS = 5000

function loadCrossfade(): number {
  try {
    const v = parseInt(localStorage.getItem(KEY) ?? '', 10)
    return Number.isFinite(v) && v >= MIN_MS && v <= MAX_MS ? v : DEFAULT_MS
  } catch { return DEFAULT_MS }
}

export interface UseCrossfadeReturn {
  /** Crossfade duration in milliseconds (0 = instant) */
  crossfadeMs: number
  /** Set crossfade duration (clamped to 0-5000ms) */
  setCrossfadeMs: (ms: number) => void
}

export function useCrossfade(): UseCrossfadeReturn {
  const [crossfadeMs, setCrossfadeMsState] = useState(loadCrossfade)

  const setCrossfadeMs = useCallback((ms: number) => {
    const clamped = Math.max(MIN_MS, Math.min(MAX_MS, Math.round(ms)))
    setCrossfadeMsState(clamped)
    try { localStorage.setItem(KEY, String(clamped)) } catch {}
  }, [])

  return { crossfadeMs, setCrossfadeMs }
}
