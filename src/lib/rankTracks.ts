/**
 * Ranking for both recommendation paths: the heuristic picks candidates, the
 * decision model orders them when it is loaded. Both adapters live behind this
 * one interface so callers never branch on ranker availability.
 */
import type { TrackMeta } from '../types'
import { choiceConfidence } from './confidence'
import { candidateSet, heuristicRecommend } from './heuristicRecommend'

export type RankerType = 'model' | 'heuristic' | null

export interface RankSignals {
  metadata: Record<string, TrackMeta>
  tagsMap: Record<string, string[]>
  playFrequencies: Record<string, number>
}

export interface RankResult {
  files: string[]
  /** Every candidate the model ranked, best first: what the UI lists in full. */
  candidates: string[]
  /** Probability of the first file: what autopilot thresholds. */
  confidence: number
  /** TypeSafe's choice confidence over all candidates: how settled the answer is. */
  choiceConfidence: number
  /** Per-file probability, so the UI can show each option's share. */
  probabilities: Record<string, number>
  ranker: RankerType
}

export interface RankDeps {
  /** False until the decision model is loaded; the heuristic carries until then. */
  ready: boolean
  /** Calibrated probabilities, one per candidate, in the order given. */
  decide?: (prompt: string, candidates: string[]) => Promise<number[]>
}

/**
 * Candidates handed to the ranker: enough to choose from, few enough to stay fast.
 * Also the exported graph's marker count — 20 options are baked into its shape, so
 * raising this needs a re-export, while a smaller library simply passes fewer.
 */
const RERANK_CANDIDATES = 20

/** Tags the ranker sees per track. The model gives each option ~24 tokens. */
const OPTION_TAGS = 2

/** Text the ranker sees for one track: terse, because the option budget is the constraint. */
export function describeTrack(filename: string, meta: TrackMeta | undefined, tags?: string[]): string {
  // Collapse the runs of spaces that replacing separators leaves behind: the text
  // is tokenised by the model, so "Downtime   Bonfire" wastes option budget.
  const name = filename
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const facts = [
    meta?.genre,
    meta?.bpm ? `${meta.bpm} BPM` : null,
    meta?.energy !== undefined ? `energy ${meta.energy.toFixed(1)}` : null,
  ].filter(Boolean)
  const top = tags?.slice(0, OPTION_TAGS)
  if (top && top.length > 0) facts.push(top.join(', '))
  return facts.length > 0 ? `${name} — ${facts.join(', ')}` : name
}

export async function rankTracks(
  prompt: string,
  files: string[],
  signals: RankSignals,
  deps: RankDeps,
  count = 5,
): Promise<RankResult> {
  if (files.length === 0) {
    return { files: [], candidates: [], confidence: 0, choiceConfidence: 0, probabilities: {}, ranker: null }
  }

  const { metadata, tagsMap, playFrequencies } = signals
  const byHeuristic = (text: string, limit = count): RankResult => {
    const result = heuristicRecommend(text, files, metadata, limit, tagsMap, playFrequencies)
    // A keyword score is not a probability, so there is nothing to show per option.
    return {
      files: result.files,
      candidates: result.files,
      confidence: result.confidence,
      choiceConfidence: 0,
      probabilities: {},
      ranker: 'heuristic',
    }
  }

  const recentPrompt = prompt.slice(-800).trim()
  if (!deps.ready || !deps.decide || !recentPrompt) return byHeuristic(prompt)

  try {
    const candidates = candidateSet(recentPrompt, files, metadata, RERANK_CANDIDATES, tagsMap, playFrequencies)
    const probabilities = await deps.decide(
      recentPrompt,
      candidates.map((file) => describeTrack(file, metadata[file], tagsMap[file])),
    )

    const ranked = candidates
      .map((file, i) => ({ file, probability: probabilities[i] ?? 0 }))
      .sort((a, b) => b.probability - a.probability)

    return {
      files: ranked.slice(0, count).map((entry) => entry.file),
      candidates: ranked.map((entry) => entry.file),
      // The model's probabilities are already calibrated: no softmax over them.
      confidence: ranked[0]?.probability ?? 0,
      choiceConfidence: choiceConfidence(probabilities),
      probabilities: Object.fromEntries(ranked.map((entry) => [entry.file, entry.probability])),
      ranker: 'model',
    }
  } catch (e) {
    console.error('[ranker] rank error:', e)
    return byHeuristic(prompt)
  }
}
