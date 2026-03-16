import { join } from 'node:path'
import type { TrackMetadata } from './analyzer'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScoreFn = (pairs: Array<{ text: string; text_pair: string }>) => Promise<number[]>

// ── In-process reranker inference ────────────────────────────────────────────
// Uses Qwen3-Reranker-0.6B as a CausalLM-based cross-encoder to score
// (transcript, track) pairs for relevance. Unlike traditional cross-encoders,
// this model uses a chat prompt and predicts "yes"/"no" token probabilities.
// Multilingual: supports 25+ languages including Portuguese, English, etc.

const MODEL_ID = 'onnx-community/Qwen3-Reranker-0.6B-ONNX'

const RERANKER_INSTRUCTION =
  'Given a spoken transcript from a tabletop RPG session, retrieve the most relevant background music or sound effect track that matches the current mood, scene, or action.'

let _onStatus: ((status: 'loading' | 'ready') => void) | null = null
let _rerankerPromise: Promise<ScoreFn> | null = null

/** Register a callback to receive model load status updates. */
export function onQwenStatus(cb: (status: 'loading' | 'ready') => void) {
  _onStatus = cb
}

/** No-op — kept for API compatibility with main.ts */
export function killQwenChild() {
  /* nothing to kill */
}

function getReranker(): Promise<ScoreFn> {
  if (_rerankerPromise) return _rerankerPromise

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs')
  let appPath = app.getAppPath()
  while (appPath !== require('node:path').dirname(appPath)) {
    if (fs.existsSync(join(appPath, 'node_modules/@huggingface/transformers'))) break
    appPath = require('node:path').dirname(appPath)
  }
  const homePath = app.getPath('home')
  const transformersPath = join(appPath, 'node_modules/@huggingface/transformers/dist/transformers.node.cjs')
  console.log('[reranker] resolved appPath:', appPath)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AutoTokenizer, AutoModelForCausalLM, env } = require(transformersPath)
  env.cacheDir = join(homePath, '.doty', 'hf-cache')
  env.allowRemoteModels = true

  console.log('[reranker] loading Qwen3-Reranker-0.6B in main process...')
  _onStatus?.('loading')

  _rerankerPromise = Promise.all([
    AutoTokenizer.from_pretrained(MODEL_ID),
    AutoModelForCausalLM.from_pretrained(MODEL_ID, { device: 'cpu', dtype: 'q4' }),
  ])
    .then(([tokenizer, model]: [unknown, unknown]) => {
      console.log('[reranker] Qwen3-Reranker-0.6B ready')
      _onStatus?.('ready')

      // Resolve "yes" and "no" token IDs once
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenYes = (tokenizer as any).convert_tokens_to_ids('yes') as number
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenNo = (tokenizer as any).convert_tokens_to_ids('no') as number

      // Return a scoring function that scores each pair individually
      const scoreFn: ScoreFn = async (pairs) => {
        const scores: number[] = []
        for (const pair of pairs) {
          const prompt = buildPrompt(pair.text, pair.text_pair)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const inputs = (tokenizer as any)(prompt, { return_tensors: 'pt' })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const output = await (model as any)(inputs)
          const logits = output.logits
          // Get logits for the last token position
          const seqLen = logits.dims[1]
          const vocabSize = logits.dims[2]
          const lastTokenLogits = logits.data as Float32Array
          const offset = (seqLen - 1) * vocabSize
          const yesLogit = lastTokenLogits[offset + tokenYes]
          const noLogit = lastTokenLogits[offset + tokenNo]
          // Softmax over [yes, no] to get relevance probability
          const maxLogit = Math.max(yesLogit, noLogit)
          const expYes = Math.exp(yesLogit - maxLogit)
          const expNo = Math.exp(noLogit - maxLogit)
          const score = expYes / (expYes + expNo)
          scores.push(score)
        }
        return scores
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

/** Build the Qwen3-Reranker chat prompt for a (query, document) pair. */
function buildPrompt(query: string, document: string): string {
  const systemMsg =
    'Judge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".'
  return (
    `<|im_start|>system\n${systemMsg}<|im_end|>\n` +
    `<|im_start|>user\n<Instruct>: ${RERANKER_INSTRUCTION}\n<Query>: ${query}\n<Document>: ${document}<|im_end|>\n` +
    `<|im_start|>assistant\n`
  )
}

function describeTrack(filename: string, meta: TrackMetadata | null, tags?: string[]): string {
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
    tagsMap: Record<string, string[]> = {},
  ): Promise<string[]> {
    if (files.length === 0) return []

    try {
      const recentTranscript = transcript.slice(-600).trim()
      if (!recentTranscript) return files.slice(0, count)

      // Limit to 100 tracks
      const candidates = files.slice(0, 100)

      // Build (transcript, track_description) pairs
      const pairs = candidates.map((f) => ({
        text: recentTranscript,
        text_pair: describeTrack(f, metadata[f] ?? null, tagsMap[f]),
      }))

      const scorer = await this.getScorer()

      console.log('[reranker] scoring', pairs.length, 'candidates...')
      const scores = await scorer(pairs)
      console.log('[reranker] scoring done')

      // Sort by score descending, take top N
      const scored = candidates.map((file, i) => ({ file, score: scores[i] }))
      scored.sort((a, b) => b.score - a.score)

      const results = scored.slice(0, count).map((s) => s.file)
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
