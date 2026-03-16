import { useCallback, useEffect, useState } from 'react'
import { topConfidence } from '../lib/autopilot'
import { heuristicRecommend } from '../lib/heuristicRecommend'
import type { TrackMeta } from '../types'

type Status = 'loading' | 'ready' | 'error'
type StatusCb = (status: Status) => void
type LogCb = (message: string) => void

export interface RerankerDownloadProgress {
  file: string
  progress: number // 0-100
  status: string // 'initiate' | 'download' | 'progress' | 'done'
}
type DownloadCb = (p: RerankerDownloadProgress) => void

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResolveFn = (v: any) => void
type RejectFn = (e: Error) => void

let _worker: Worker | null = null
let _msgId = 0
const _pending = new Map<number, { resolve: ResolveFn; reject: RejectFn }>()
const _statusListeners = new Set<StatusCb>()
const _logListeners = new Set<LogCb>()
const _downloadListeners = new Set<DownloadCb>()
let _currentStatus: Status = 'loading'
/** Tracks whether we've seen actual download activity (not just cache hits) */
let _isDownloading = false
let _downloadDone = false

function getWorker(): Worker {
  if (_worker) return _worker
  console.log('[reranker-hook] creating worker...')
  _worker = new Worker(new URL('../workers/qwen-worker.ts', import.meta.url))
  _worker.onmessage = (e) => {
    const msg = e.data
    if (msg.type === 'status') {
      console.log('[reranker-hook] status:', msg.status, msg.message ?? '')
      _currentStatus = msg.status
      if (msg.status === 'ready') _downloadDone = true
      _statusListeners.forEach((cb) => {
        cb(msg.status)
      })
      return
    }
    if (msg.type === 'log') {
      console.log('[reranker-worker]', msg.message)
      _logListeners.forEach((cb) => {
        cb(msg.message)
      })
      return
    }
    if (msg.type === 'progress') {
      const p = msg as Record<string, unknown>
      const pct = typeof p.progress === 'number' ? ` ${(p.progress as number).toFixed(1)}%` : ''
      const file = (p.file ?? p.name ?? '') as string
      _logListeners.forEach((cb) => {
        cb(`[${p.status}] ${file}${pct}`)
      })
      // Track download activity for the download overlay
      if (p.status === 'download' || p.status === 'progress' || p.status === 'initiate') {
        _isDownloading = true
        _downloadListeners.forEach((cb) => {
          cb({
            file,
            progress: typeof p.progress === 'number' ? (p.progress as number) : 0,
            status: p.status as string,
          })
        })
      } else if (p.status === 'done') {
        _downloadListeners.forEach((cb) => {
          cb({
            file,
            progress: 100,
            status: 'done',
          })
        })
      }
      return
    }
    const p = _pending.get(msg.id)
    if (!p) return
    _pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.output)
  }
  _worker.onerror = (e) => {
    console.error('[reranker-hook] worker onerror:', e.message, e.filename, e.lineno, e.error)
    for (const [id, p] of _pending) {
      _pending.delete(id)
      p.reject(new Error(e.message || 'worker error'))
    }
    _worker = null
  }
  _worker.onmessageerror = (e) => {
    console.error('[reranker-hook] worker messageerror:', e)
  }
  console.log('[reranker-hook] worker created')
  return _worker
}

/**
 * Send pairs to the reranker worker and get back relevance scores.
 */
function workerRerank(pairs: Array<{ text: string; text_pair: string }>): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const id = ++_msgId
    _pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, pairs })
  })
}

/**
 * Build a concise description of a track for the reranker.
 * The reranker scores (query, document) relevance, so we want a
 * descriptive string that captures the track's character.
 */
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
  if (tags && tags.length > 0) {
    parts.push(`tags: ${tags.join(', ')}`)
  }
  return parts.join(', ')
}

/** Number of heuristic pre-filter candidates to rerank */
const RERANK_CANDIDATES = 20

export type RankerType = 'reranker' | 'heuristic' | null

/** Result from recommend() including confidence for autopilot */
export interface RecommendResult {
  files: string[]
  /** Top-1 confidence (softmax probability), 0-1. Only set when reranker is used. */
  confidence: number
  ranker: RankerType
}

export function useQwen() {
  const [modelStatus, setModelStatus] = useState<Status>(_currentStatus)
  const [downloading, setDownloading] = useState(_isDownloading && !_downloadDone)
  const [downloadProgress, setDownloadProgress] = useState<RerankerDownloadProgress | null>(null)
  const [lastRanker, setLastRanker] = useState<RankerType>(null)

  useEffect(() => {
    const statusCb: StatusCb = (s) => {
      setModelStatus(s)
      if (s === 'ready') setDownloading(false)
    }
    const dlCb: DownloadCb = (p) => {
      setDownloading(true)
      setDownloadProgress(p)
    }
    _statusListeners.add(statusCb)
    _downloadListeners.add(dlCb)
    // Eagerly spin up the worker — model starts loading immediately
    getWorker()
    return () => {
      _statusListeners.delete(statusCb)
      _downloadListeners.delete(dlCb)
    }
  }, [])

  const recommend = useCallback(async (transcript: string, files: string[], count = 5): Promise<RecommendResult> => {
    console.log(
      '[reranker-hook] recommend() called — transcript:',
      transcript.length,
      'chars, files:',
      files.length,
      'count:',
      count,
      'status:',
      _currentStatus,
    )
    if (files.length === 0) return { files: [], confidence: 0, ranker: null }

    // Fetch metadata, tags, and play history for all tracks
    const metadata = (await window.doty.getAllMetadata()) as Record<string, TrackMeta>
    const tagsMap = (await window.doty.getTagsMap()) as Record<string, string[]>
    const playFrequencies = await window.doty.getPlayFrequencies('music')
    console.log(
      '[reranker-hook] metadata keys:',
      Object.keys(metadata).length,
      'tags keys:',
      Object.keys(tagsMap).length,
    )

    // While model is loading or if it errors, use the heuristic ranker
    if (_currentStatus !== 'ready') {
      console.log('[reranker-hook] model not ready (status:', _currentStatus, ') — using heuristic ranker')
      setLastRanker('heuristic')
      const result = heuristicRecommend(transcript, files, metadata, count, tagsMap, playFrequencies)
      console.log('[reranker-hook] heuristic results:', result.files, 'confidence:', result.confidence)
      return { files: result.files, confidence: result.confidence, ranker: 'heuristic' }
    }

    try {
      // Use the most recent portion of the input for relevance
      const recentTranscript = transcript.slice(-800).trim()
      if (!recentTranscript) {
        console.log('[reranker-hook] empty transcript after trim, falling back to heuristic')
        setLastRanker('heuristic')
        const result = heuristicRecommend(transcript, files, metadata, count, tagsMap, playFrequencies)
        return { files: result.files, confidence: result.confidence, ranker: 'heuristic' }
      }

      // Step 1: Pre-filter with heuristic to get top N candidates
      const hResult = heuristicRecommend(recentTranscript, files, metadata, RERANK_CANDIDATES, tagsMap, playFrequencies)
      console.log('[reranker-hook] heuristic pre-filter candidates:', hResult.files.length)

      // Step 2: Build (transcript, track_description) pairs for the reranker
      const pairs = hResult.files.map((file) => ({
        text: recentTranscript,
        text_pair: describeTrack(file, metadata[file], tagsMap[file]),
      }))

      console.log(
        '[reranker-hook] reranking',
        pairs.length,
        'candidates, sample pair:',
        pairs[0]?.text_pair?.slice(0, 80),
      )
      const scores = await workerRerank(pairs)

      // Step 3: Compute confidence via softmax over reranker logits
      const { confidence } = topConfidence(scores)
      console.log('[reranker-hook] top-1 confidence:', (confidence * 100).toFixed(1) + '%')

      // Step 4: Sort by reranker score and take top N
      const scored = hResult.files.map((file, i) => ({ file, score: scores[i] }))
      scored.sort((a, b) => b.score - a.score)

      const results = scored.slice(0, count).map((s) => s.file)
      console.log('[reranker-hook] reranked results:', results)
      setLastRanker('reranker')
      return { files: results, confidence, ranker: 'reranker' }
    } catch (e) {
      console.error('[reranker-hook] recommend error:', e)
      setLastRanker('heuristic')
      const result = heuristicRecommend(transcript, files, metadata, count, tagsMap, playFrequencies)
      return { files: result.files, confidence: result.confidence, ranker: 'heuristic' }
    }
  }, [])

  return { recommend, modelStatus, downloading, downloadProgress, lastRanker }
}

/** Subscribe to verbose log messages from the reranker worker. Returns unsubscribe fn. */
export function onQwenLog(cb: LogCb): () => void {
  _logListeners.add(cb)
  // Eagerly spin up the worker so logs start flowing
  getWorker()
  return () => {
    _logListeners.delete(cb)
  }
}
