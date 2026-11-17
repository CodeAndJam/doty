/**
 * Search one lane, as the two browse panels do.
 *
 * Debounced so typing does not fire an embedding per keystroke, and cancelled on
 * every new query so a slow answer cannot overwrite a newer one. The previous
 * results stay on screen while the next query is in flight — a list that blinks
 * empty on every keystroke reads as "no matches".
 *
 * The index status is a subscription, not a second request: asking for it on
 * every keystroke made the results wait for a full library walk.
 */
import { useEffect, useMemo, useState } from 'react'
import type { IndexProgress } from '../types'

export interface SearchHit {
  key: string
  path: string
  lane: 'music' | 'sfx'
  absolute: string
  origin: 'music' | 'sfx'
}

export interface SearchState {
  hits: SearchHit[]
  mode: 'semantic' | 'text'
  index: IndexProgress | null
}

/** The path that actually plays for this hit. */
export function playablePath(hit: SearchHit): string {
  return hit.origin === 'music' ? hit.path : hit.absolute
}

export function useLibrarySearch(query: string, lane: 'music' | 'sfx', k = 50): SearchState | null {
  const [state, setState] = useState<SearchState | null>(null)
  const [index, setIndex] = useState<IndexProgress | null>(null)
  /** Bumped by a rescan or a finished index, so an open answer is redone. */
  const [revision, setRevision] = useState(0)
  const trimmed = query.trim()

  useEffect(() => {
    let live = true
    const unsubProgress = window.doty.onEmbeddingProgress((status) => {
      if (live) setIndex(status)
    })
    const refresh = () => {
      setRevision((r) => r + 1)
    }
    const unsubScan = window.doty.onScanComplete(refresh)
    const unsubSfx = window.doty.onSfxChanged(refresh)
    window.doty
      .embeddingStatus()
      .then((status) => {
        if (live) setIndex(status)
      })
      .catch(() => {})
    return () => {
      live = false
      unsubProgress()
      unsubScan()
      unsubSfx()
    }
  }, [])

  useEffect(() => {
    if (!trimmed) {
      setState(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      window.doty
        .librarySearch(trimmed, lane, k)
        .then((result) => {
          if (!cancelled) setState({ hits: result.items, mode: result.mode, index: null })
        })
        .catch(() => {
          if (!cancelled) setState({ hits: [], mode: 'text', index: null })
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, lane, k, revision])

  return useMemo(() => (state ? { ...state, index } : null), [state, index])
}
