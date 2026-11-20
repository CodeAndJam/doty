import { useCallback, useEffect, useState } from 'react'
import { type RankerType, rankTracks } from '../lib/rankTracks'

export type { RankerType } from '../lib/rankTracks'

type Status = 'loading' | 'ready' | 'error'

export interface RecommendResult {
  files: string[]
  candidates: string[]
  confidence: number
  choiceConfidence: number
  probabilities: Record<string, number>
  ranker: RankerType
}

let _currentStatus: Status = 'loading'
let _warmupRequested = false

/** Load the ranker in the background (idle, or on the first recommendation). */
function requestWarmup(setModelStatus: (s: Status) => void): void {
  if (_warmupRequested) return
  _warmupRequested = true
  window.doty
    .rankerStatus()
    .then(({ cached }) => {
      if (!cached) {
        // Deciding without the graph can only throw ENOENT and log an unhandled
        // handler error. Stay on keywords until the download finishes.
        _warmupRequested = false
        _currentStatus = 'error'
        setModelStatus('error')
        return
      }
      return window.doty
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
    })
    .catch(() => {
      _warmupRequested = false
      _currentStatus = 'error'
      setModelStatus('error')
    })
}

export function useRanker() {
  const [modelStatus, setModelStatus] = useState<Status>(_currentStatus)

  useEffect(() => {
    const unsub = window.doty.onRankerStatus((status: string) => {
      _currentStatus = status as Status
      // A post-warmup worker error must allow the next recommendation to respawn it
      if (status === 'error') _warmupRequested = false
      setModelStatus(status as Status)
    })

    // The graph loads on the first recommendation (requestWarmup), not at idle.
    // A session nobody ranks in never initialises ONNX at all.
    return unsub
  }, [])

  const recommend = useCallback(async (transcript: string, files: string[], count = 5): Promise<RecommendResult> => {
    if (files.length === 0) {
      return { files: [], candidates: [], confidence: 0, choiceConfidence: 0, probabilities: {}, ranker: null }
    }

    const { metadata, tagsMap, playFrequencies } = await window.doty.recommendSignals()

    const ready = _currentStatus === 'ready'
    if (!ready) requestWarmup(setModelStatus)

    const result = await rankTracks(
      transcript,
      files,
      { metadata, tagsMap, playFrequencies },
      { ready, decide: window.doty.rankerDecide },
      count,
    )

    return result
  }, [])

  return { recommend, modelStatus }
}
