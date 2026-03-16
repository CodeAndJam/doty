/**
 * Integration test: downloads the real mmarco-mMiniLMv2-L12-H384-v1 model
 * and runs reranking to verify the multilingual pipeline works end-to-end.
 *
 * Uses a temporary cache directory that is cleaned up after each run.
 * First run downloads ~450 MB (may take a few minutes).
 *
 * Run with:  npx vitest run electron/qwen-integration.test.ts
 *
 * @vitest-environment node
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const MODEL_ID = 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1'

// Create a fresh temp directory for each test run
const CACHE_DIR = mkdtempSync(join(tmpdir(), 'doty-reranker-test-'))

describe('mMiniLM multilingual reranker integration', { timeout: 600_000 }, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tokenizer: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let model: any = null

  beforeAll(async () => {
    console.log('[integration] temp cacheDir:', CACHE_DIR)
    const transformers = await import('@huggingface/transformers')
    const { AutoTokenizer, AutoModelForSequenceClassification, env } = transformers
    env.cacheDir = CACHE_DIR
    env.allowRemoteModels = true
    env.allowLocalModels = true

    console.log('[integration] loading model...')
    const t0 = Date.now()

    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)
    model = await AutoModelForSequenceClassification.from_pretrained(MODEL_ID, {
      progress_callback: (p: Record<string, unknown>) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          const file = (p.file ?? p.name ?? '') as string
          console.log(`[integration] ${file} ${(p.progress as number).toFixed(1)}%`)
        } else if (p.status === 'done') {
          console.log(`[integration] ${p.file ?? p.name ?? 'file'} done`)
        }
      },
    })

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`[integration] model loaded in ${elapsed}s`)
  }, 600_000)

  afterAll(() => {
    console.log('[integration] cleaning up temp cache:', CACHE_DIR)
    try {
      rmSync(CACHE_DIR, { recursive: true, force: true })
    } catch (e) {
      console.warn('[integration] cleanup failed (non-fatal):', e)
    }
  })

  /** Score (query, passage) pairs in a single batched call — returns raw logits. */
  async function scoreBatch(pairs: Array<{ query: string; passage: string }>): Promise<number[]> {
    const queries = pairs.map((p) => p.query)
    const passages = pairs.map((p) => p.passage)
    const inputs = tokenizer(queries, { text_pair: passages, padding: true, truncation: true })
    const { logits } = await model(inputs)
    return Array.from(logits.data as Float32Array)
  }

  it('loads the model successfully', () => {
    expect(tokenizer).toBeTruthy()
    expect(model).toBeTruthy()
  })

  it('scores a relevant pair higher than an irrelevant pair (English)', async () => {
    const scores = await scoreBatch([
      {
        query: 'We are sitting around a warm campfire telling stories',
        passage: 'Campfire, genre: ambient, energy: 0.3, danceability: 0.1',
      },
      {
        query: 'We are sitting around a warm campfire telling stories',
        passage: 'Decisive Battle Rivals, genre: metal, energy: 0.95, 180 BPM',
      },
    ])

    const [relevantScore, irrelevantScore] = scores
    console.log(`[integration] EN relevant: ${relevantScore}, irrelevant: ${irrelevantScore}`)

    expect(relevantScore).toBeGreaterThan(irrelevantScore)
  })

  it('scores a relevant pair higher than an irrelevant pair (Portuguese)', async () => {
    const scores = await scoreBatch([
      {
        query: 'Estamos sentados à volta da fogueira a contar histórias',
        passage: 'Campfire Rest, genre: ambient, energy: 0.3, tags: fogueira, descanso',
      },
      {
        query: 'Estamos sentados à volta da fogueira a contar histórias',
        passage: 'Decisive Battle Rivals, genre: metal, energy: 0.95, tags: combate',
      },
    ])

    const [relevantScore, irrelevantScore] = scores
    console.log(`[integration] PT campfire relevant: ${relevantScore}, irrelevant: ${irrelevantScore}`)

    expect(relevantScore).toBeGreaterThan(irrelevantScore)
  })

  it('ranks combat music higher for Portuguese combat transcript', async () => {
    const scores = await scoreBatch([
      {
        query: 'o grupo entra em combate contra o dragão',
        passage: 'Battle Theme Epic Warriors, genre: orchestral, energy: 0.9',
      },
      {
        query: 'o grupo entra em combate contra o dragão',
        passage: 'Campfire Calm Rest, genre: ambient, energy: 0.2',
      },
    ])

    const [combatScore, calmScore] = scores
    console.log(`[integration] PT combat: ${combatScore}, calm: ${calmScore}`)

    expect(combatScore).toBeGreaterThan(calmScore)
  })

  it('returns meaningful scores for multiple pairs', async () => {
    const scores = await scoreBatch([
      { query: 'dark spooky dungeon', passage: 'Horror Ambience Dark n Deep' },
      { query: 'dark spooky dungeon', passage: 'Relaxation Panorama' },
      { query: 'dark spooky dungeon', passage: 'Haunted Cemetery Corrupted Innocence' },
    ])

    console.log('[integration] multi-pair scores:', scores)

    expect(scores).toHaveLength(3)
    scores.forEach((s) => {
      expect(typeof s).toBe('number')
    })

    // Horror/haunted tracks should score higher than relaxation for "dark spooky dungeon"
    const [horrorScore, relaxScore] = scores
    expect(horrorScore).toBeGreaterThan(relaxScore)
  })
})
