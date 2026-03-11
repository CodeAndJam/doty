import { join } from 'path'
import type { TrackMetadata } from './analyzer'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScoreFn = (pairs: Array<{ text: string; text_pair: string }>) => Promise<number[]>

// ── In-process reranker inference (HuggingFace official pattern) ─────────────
// Uses ms-marco-MiniLM-L-6-v2 as a cross-encoder to score (transcript, track)
// pairs for relevance. Uses AutoTokenizer + AutoModelForSequenceClassification
// directly to extract raw logits — the text-classification pipeline applies
// softmax which always returns 1.0 for single-label cross-encoders.

const MODEL_ID = 'Xenova/ms-marco-MiniLM-L-6-v2'

let _onStatus: ((status: 'loading' | 'ready') => void) | null = null
let _rerankerPromise: Promise<ScoreFn> | null = null

/** Register a callback to receive model load status updates. */
export function onQwenStatus(cb: (status: 'loading' | 'ready') => void) {
  _onStatus = cb
}

/** No-op — kept for API compatibility with main.ts */
export function killQwenChild() { /* nothing to kill */ }

function getReranker(): Promise<ScoreFn> {
  if (_rerankerPromise) return _rerankerPromise

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs')
  let appPath = app.getAppPath()
  while (appPath !== require('path').dirname(appPath)) {
    if (fs.existsSync(join(appPath, 'node_modules/@huggingface/transformers'))) break
    appPath = require('path').dirname(appPath)
  }
  const homePath = app.getPath('home')
  const transformersPath = join(appPath, 'node_modules/@huggingface/transformers/dist/transformers.node.cjs')
  console.log('[reranker] resolved appPath:', appPath)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AutoTokenizer, AutoModelForSequenceClassification, env } = require(transformersPath)
  env.cacheDir = join(homePath, '.doty', 'hf-cache')
  env.allowRemoteModels = true

  console.log('[reranker] loading model in main process...')
  _onStatus?.('loading')

  _rerankerPromise = Promise.all([
    AutoTokenizer.from_pretrained(MODEL_ID),
    AutoModelForSequenceClassification.from_pretrained(MODEL_ID, { device: 'cpu', dtype: 'q4' }),
  ]).then(([tokenizer, model]: [unknown, unknown]) => {
      console.log('[reranker] model ready')
      _onStatus?.('ready')
      // Return a scoring function that batches all pairs in one call
      const scoreFn: ScoreFn = async (pairs) => {
        const queries = pairs.map(p => p.text)
        const passages = pairs.map(p => p.text_pair)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inputs = (tokenizer as any)(queries, { text_pair: passages, padding: true, truncation: true })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { logits } = await (model as any)(inputs)
        return Array.from(logits.data as Float32Array)
      }
      return scoreFn
    })
    .catch((err: unknown) => {
      console.error('[reranker] model load failed:', err)
      _rerankerPromise = null
      throw err
    })

  return _rerankerPromise
}

function describeTrack(filename: string, meta: TrackMetadata | null): string {
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
  return parts.join(', ')
}

export class QwenManager {
  private scoreFn: ScoreFn | null = null
  private readonly externalScoreFn: ScoreFn | null

  /** Pass a mock ScoreFn in tests to avoid loading Electron/transformers. */
  constructor(scoreFn?: ScoreFn) {
    this.externalScoreFn = scoreFn ?? null
  }

  private async getScorer(): Promise<ScoreFn> {
    if (this.scoreFn) return this.scoreFn
    if (this.externalScoreFn) {
      this.scoreFn = this.externalScoreFn
      return this.scoreFn
    }
    this.scoreFn = await getReranker()
    return this.scoreFn
  }

  async recommend(
    transcript: string,
    files: string[],
    metadata: Record<string, TrackMetadata> = {},
    count = 5,
  ): Promise<string[]> {
    if (files.length === 0) return []

    try {
      const recentTranscript = transcript.slice(-600).trim()
      if (!recentTranscript) return files.slice(0, count)

      // Limit to 100 tracks
      const candidates = files.slice(0, 100)

      // Build (transcript, track_description) pairs
      const pairs = candidates.map(f => ({
        text: recentTranscript,
        text_pair: describeTrack(f, metadata[f] ?? null),
      }))

      const scorer = await this.getScorer()

      console.log('[reranker] scoring', pairs.length, 'candidates...')
      const scores = await scorer(pairs)
      console.log('[reranker] scoring done')

      // Sort by score descending, take top N
      const scored = candidates.map((file, i) => ({ file, score: scores[i] }))
      scored.sort((a, b) => b.score - a.score)

      const results = scored.slice(0, count).map(s => s.file)
      if (results.length > 0) {
        console.log('[reranker] recommendations:', results)
        return results
      }

      console.log('[reranker] no scores, falling back')
      return files.slice(0, count)
    } catch (e) {
      console.error('[reranker] recommend error:', e)
      return files.slice(0, count)
    }
  }
}
