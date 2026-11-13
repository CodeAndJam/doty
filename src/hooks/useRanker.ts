import { useCallback, useEffect, useState } from 'react'
import { type RankerType, rankTracks } from '../lib/rankTracks'
import type { TrackMeta } from '../types'

export type { RankerType } from '../lib/rankTracks'

type Status = 'loading' | 'ready' | 'error'

export interface RecommendResult {
  files: string[]
  confidence: number
  ranker: RankerType
}

let _currentStatus: Status = 'loading'
let _warmupRequested = false

/** Load the ranker in the background (idle, or on the first recommendation). */
function requestWarmup(setModelStatus: (s: Status) => void): void {
  if (_warmupRequested) return
  _warmupRequested = true
  window.doty
    .rankerDecide('', [])
    .then(() => {
      _currentStatus = 'ready'
      setModelStatus('ready')
    })
    .catch(() => {
      _warmupRequested = false
      _currentStatus = 'error'
      setModelStatus('error')
    })
}

export function useRanker() {
  const [modelStatus, setModelStatus] = useState<Status>(_currentStatus)
  const [lastRanker, setLastRanker] = useState<RankerType>(null)

  useEffect(() => {
    const unsub = window.doty.onRankerStatus((status: string) => {
      _currentStatus = status as Status
      // A post-warmup worker error must allow the next recommendation to respawn it
      if (status === 'error') _warmupRequested = false
      setModelStatus(status as Status)
    })

    // Warm the model during idle time so startup stays snappy. Recommendations
    // use the heuristic path until it is ready.
    const warm = () => requestWarmup(setModelStatus)
    let idleId: number | undefined
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(warm, { timeout: 10_000 })
    } else {
      timeoutId = setTimeout(warm, 5_000)
    }

    return () => {
      unsub()
      if (idleId !== undefined) window.cancelIdleCallback(idleId)
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }, [])

  const recommend = useCallback(async (transcript: string, files: string[], count = 5): Promise<RecommendResult> => {
    if (files.length === 0) return { files: [], confidence: 0, ranker: null }

    const [metadata, tagsMap, playFrequencies] = await Promise.all([
      window.doty.getAllMetadata() as Promise<Record<string, TrackMeta>>,
      window.doty.getTagsMap(),
      window.doty.getPlayFrequencies('music'),
    ])

    const ready = _currentStatus === 'ready'
    if (!ready) requestWarmup(setModelStatus)

    const result = await rankTracks(
      transcript,
      files,
      { metadata, tagsMap, playFrequencies },
      { ready, decide: window.doty.rankerDecide },
      count,
    )

    setLastRanker(result.ranker)
    return result
  }, [])

  return { recommend, modelStatus, lastRanker }
}
