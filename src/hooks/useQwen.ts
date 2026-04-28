import { useCallback, useEffect, useState } from 'react'
import { topConfidence } from '../lib/autopilot'
import { heuristicRecommend } from '../lib/heuristicRecommend'
import type { TrackMeta } from '../types'

type Status = 'loading' | 'ready' | 'error'

export type RankerType = 'reranker' | 'heuristic' | null

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

function describeTrack(filename: string, meta: TrackMeta | undefined, tags?: string[]): string {
  const name = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
  const parts = [name]
  if (meta) {
    if (meta.artist) parts.push(`by ${meta.artist}`)
    if (meta.genre) parts.push(`genre: ${meta.genre}`)
    if (meta.bpm) parts.push(`${meta.bpm} BPM`)
    if (meta.energy) parts.push(`energy: ${meta.energy}`)
    if (meta.key && meta.key !== 'Unknown') {
      const keyStr = meta.scale === 'minor' ? `${meta.key}m` : meta.key
      parts.push(`key: ${keyStr}`)
    }
    if (meta.danceability) parts.push(`danceability: ${meta.danceability}`)
  }
  if (tags && tags.length > 0) parts.push(`tags: ${tags.join(', ')}`)
  return parts.join(', ')
}

const RERANK_CANDIDATES = 20

export function useQwen() {
  const [modelStatus, setModelStatus] = useState<Status>(_currentStatus)
  const [downloadProgress] = useState<RerankerDownloadProgress | null>(null)
  const [lastRanker, setLastRanker] = useState<RankerType>(null)

  useEffect(() => {
    // Listen for status from main process
    const unsub = window.doty.onRerankerStatus((status: string) => {
      _currentStatus = status as Status
      setModelStatus(status as Status)
    })
    // Trigger model load with a dummy pair
    window.doty
      .rerankerScore([{ text: 'test', text_pair: 'test' }])
      .then(() => {
        _currentStatus = 'ready'
        setModelStatus('ready')
      })
      .catch(() => {
        _currentStatus = 'error'
        setModelStatus('error')
      })
    return unsub
  }, [])

  const recommend = useCallback(async (transcript: string, files: string[], count = 5): Promise<RecommendResult> => {
    if (files.length === 0) return { files: [], confidence: 0, ranker: null }

    const metadata = (await window.doty.getAllMetadata()) as Record<string, TrackMeta>
    const tagsMap = (await window.doty.getTagsMap()) as Record<string, string[]>
    const playFrequencies = await window.doty.getPlayFrequencies('music')

    if (_currentStatus !== 'ready') {
      setLastRanker('heuristic')
      const result = heuristicRecommend(transcript, files, metadata, count, tagsMap, playFrequencies)
      return { files: result.files, confidence: result.confidence, ranker: 'heuristic' }
    }

    try {
      const recentTranscript = transcript.slice(-800).trim()
      if (!recentTranscript) {
        setLastRanker('heuristic')
        const result = heuristicRecommend(transcript, files, metadata, count, tagsMap, playFrequencies)
        return { files: result.files, confidence: result.confidence, ranker: 'heuristic' }
      }

      const hResult = heuristicRecommend(recentTranscript, files, metadata, RERANK_CANDIDATES, tagsMap, playFrequencies)

      const pairs = hResult.files.map((file) => ({
        text: recentTranscript,
        text_pair: describeTrack(file, metadata[file], tagsMap[file]),
      }))

      const scores = await window.doty.rerankerScore(pairs)
      const { confidence } = topConfidence(scores)

      const scored = hResult.files.map((file, i) => ({ file, score: scores[i] }))
      scored.sort((a, b) => b.score - a.score)

      setLastRanker('reranker')
      return { files: scored.slice(0, count).map((s) => s.file), confidence, ranker: 'reranker' }
    } catch (e) {
      console.error('[reranker] recommend error:', e)
      setLastRanker('heuristic')
      const result = heuristicRecommend(transcript, files, metadata, count, tagsMap, playFrequencies)
      return { files: result.files, confidence: result.confidence, ranker: 'heuristic' }
    }
  }, [])

  return { recommend, modelStatus, downloading: false, downloadProgress, lastRanker }
}

/** No-op — kept for API compatibility */
export function onQwenLog(_cb: (msg: string) => void): () => void {
  return () => {}
}
