/**
 * Search one lane, as the two browse panels do.
 *
 * Debounced so typing does not fire an embedding per keystroke, and cancelled on
 * every new query so a slow answer cannot overwrite a newer one. The previous
 * results stay on screen while the next query is in flight — a list that blinks
 * empty on every keystroke is worse than one that lags by a quarter second.
 */
import { useEffect, useState } from 'react'
import type { IndexProgress } from '../types'

export interface SearchHit {
  key: string
  path: string
  lane: 'music' | 'sfx'
  absolute: string
}

export interface SearchState {
  hits: SearchHit[]
  mode: 'semantic' | 'text'
  index: IndexProgress | null
}

export function useLibrarySearch(query: string, lane: 'music' | 'sfx', k = 12): SearchState | null {
  const [state, setState] = useState<SearchState | null>(null)
  const trimmed = query.trim()

  useEffect(() => {
    if (!trimmed) {
      setState(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      Promise.all([window.doty.librarySearch(trimmed, lane, k), window.doty.embeddingStatus().catch(() => null)])
        .then(([result, index]) => {
          if (cancelled) return
          setState({ hits: result.items, mode: result.mode, index })
        })
        .catch(() => {
          if (!cancelled) setState({ hits: [], mode: 'text', index: null })
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, lane, k])

  return state
}
