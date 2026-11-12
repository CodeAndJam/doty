import { useCallback, useEffect, useState } from 'react'
import { type RankerType, rankTracks } from '../lib/rankTracks'
import type { TrackMeta } from '../types'

export type { RankerType } from '../lib/rankTracks'

type Status = 'loading' | 'ready' | 'error'

export interface RerankerDownloadProgress {
  file: string
  progress: number
  status: string
}

export interface RecommendResult {
  files: string[]
  confidence: number
  ranker: RankerType
}

let _currentStatus: Status = 'loading'
let _warmupRequested = false

/** Load the reranker in the background (idle, or on the first recommendation). */
function requestWarmup(setModelStatus: (s: Status) => void): void {
  if (_warmupRequested) return
  _warmupRequested = true
  window.doty
    .rerankerScore([{ text: 'test', text_pair: 'test' }])
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

export function useQwen() {
  const [modelStatus, setModelStatus] = useState<Status>(_currentStatus)
  const [downloadProgress, setDownloadProgress] = useState<RerankerDownloadProgress | null>(null)
  const [lastRanker, setLastRanker] = useState<RankerType>(null)

  useEffect(() => {
    // Listen for status from main process
    const unsub = window.doty.onRerankerStatus((status: string) => {
      _currentStatus = status as Status
      // A post-warmup worker error must allow the next recommendation to respawn it
      if (status === 'error') _warmupRequested = false
      setModelStatus(status as Status)
    })
    const unsubProgress = window.doty.onRerankerDownloadProgress((p) => {
      setDownloadProgress(p)
      if (p.status === 'done' || p.status === 'ready') setDownloadProgress(null)
    })

    // Warm the model during idle time so startup and model downloads stay snappy.
    // Recommendations use the heuristic path until it is ready.
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
      unsubProgress()
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
      { ready, score: window.doty.rerankerScore },
      count,
    )

    setLastRanker(result.ranker)
    return result
  }, [])

  return { recommend, modelStatus, downloading: false, downloadProgress, lastRanker }
}
