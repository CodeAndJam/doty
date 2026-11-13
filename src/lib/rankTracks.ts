/**
 * Ranking for both recommendation paths: the heuristic picks candidates, the
 * cross-encoder orders them when it is loaded. Both adapters live behind this
 * one interface so callers never branch on ranker availability.
 */
import type { TrackMeta } from '../types'
import { topConfidence } from './autopilot'
import { heuristicRecommend } from './heuristicRecommend'

export type RankerType = 'reranker' | 'heuristic' | null

export interface RankSignals {
  metadata: Record<string, TrackMeta>
  tagsMap: Record<string, string[]>
  playFrequencies: Record<string, number>
}

export interface RankResult {
  files: string[]
  confidence: number
  ranker: RankerType
}

export interface RankDeps {
  /** False until the reranker model is loaded; the heuristic carries until then. */
  ready: boolean
  score?: (pairs: Array<{ text: string; text_pair: string }>) => Promise<number[]>
}

/** Candidates handed to the cross-encoder: enough to rerank, few enough to stay fast. */
const RERANK_CANDIDATES = 20

/** Text the cross-encoder sees for one track: name, audio features and user tags. */
function describeTrack(filename: string, meta: TrackMeta | undefined, tags?: string[]): string {
  const key = meta?.key && meta.key !== 'Unknown' ? (meta.scale === 'minor' ? `${meta.key}m` : meta.key) : null
  const features = [
    meta?.artist ? `by ${meta.artist}` : null,
    meta?.genre ? `genre: ${meta.genre}` : null,
    meta?.bpm ? `${meta.bpm} BPM` : null,
    meta?.energy ? `energy: ${meta.energy}` : null,
    key ? `key: ${key}` : null,
    meta?.danceability ? `danceability: ${meta.danceability}` : null,
    tags && tags.length > 0 ? `tags: ${tags.join(', ')}` : null,
  ]
  const name = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
  return [name, ...features.filter(Boolean)].join(', ')
}

export async function rankTracks(
  prompt: string,
  files: string[],
  signals: RankSignals,
  deps: RankDeps,
  count = 5,
): Promise<RankResult> {
  if (files.length === 0) return { files: [], confidence: 0, ranker: null }

  const { metadata, tagsMap, playFrequencies } = signals
  const byHeuristic = (text: string, limit = count): RankResult => {
    const result = heuristicRecommend(text, files, metadata, limit, tagsMap, playFrequencies)
    return { files: result.files, confidence: result.confidence, ranker: 'heuristic' }
  }

  const recentPrompt = prompt.slice(-800).trim()
  if (!deps.ready || !deps.score || !recentPrompt) return byHeuristic(prompt)

  try {
    const candidates = heuristicRecommend(
      recentPrompt,
      files,
      metadata,
      RERANK_CANDIDATES,
      tagsMap,
      playFrequencies,
    ).files
    const pairs = candidates.map((file) => ({
      text: recentPrompt,
      text_pair: describeTrack(file, metadata[file], tagsMap[file]),
    }))

    const scores = await deps.score(pairs)
    const { confidence } = topConfidence(scores)
    const ranked = candidates.map((file, i) => ({ file, score: scores[i] }))
    ranked.sort((a, b) => b.score - a.score)

    return { files: ranked.slice(0, count).map((entry) => entry.file), confidence, ranker: 'reranker' }
  } catch (e) {
    console.error('[reranker] rank error:', e)
    return byHeuristic(prompt)
  }
}
