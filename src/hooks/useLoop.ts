import { useCallback, useState } from 'react'
import type { LoopMode } from '../types'

const LOOP_KEY = 'doty:loopMode'

function loadLoopMode(): LoopMode {
  try {
    const v = localStorage.getItem(LOOP_KEY)
    if (v === 'off' || v === 'single' || v === 'queue') return v
  } catch {}
  return 'single' // default: loop single track (ambient music use case)
}

export interface UseLoopReturn {
  loopMode: LoopMode
  setLoopMode: (mode: LoopMode) => void
  /** Cycle through modes: off → single → queue → off */
  cycleLoopMode: () => void
}

const CYCLE_ORDER: LoopMode[] = ['off', 'single', 'queue']

export function useLoop(): UseLoopReturn {
  const [loopMode, setLoopModeState] = useState<LoopMode>(loadLoopMode)

  const setLoopMode = useCallback((mode: LoopMode) => {
    setLoopModeState(mode)
    try {
      localStorage.setItem(LOOP_KEY, mode)
    } catch {}
  }, [])

  const cycleLoopMode = useCallback(() => {
    setLoopModeState((prev) => {
      const idx = CYCLE_ORDER.indexOf(prev)
      const next = CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length]
      try {
        localStorage.setItem(LOOP_KEY, next)
      } catch {}
      return next
    })
  }, [])

  return { loopMode, setLoopMode, cycleLoopMode }
}
