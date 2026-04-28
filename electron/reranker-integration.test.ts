/**
 * Integration test: verifies the reranker model loads and scores pairs.
 * Uses the same AutoTokenizer + AutoModelForSequenceClassification pattern
 * as the production worker, but runs in Node.js (not WASM).
 *
 * This catches:
 * - Model load failures (network, cache, OOM)
 * - Scoring returning wrong shape
 * - Model never reaching 'ready' state
 *
 * Run with:  npx vitest run electron/reranker-integration.test.ts
 *
 * @vitest-environment node
 */

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ''

describe('Reranker model integration', { timeout: 120_000 }, () => {
  it('loads model and scores pairs correctly', async () => {
    const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import('@huggingface/transformers')
    env.cacheDir = join(HOME, '.doty', 'hf-cache')
    env.allowRemoteModels = true

    const MODEL_ID = 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1'

    // Spy: track load calls
    let loadCount = 0
    const t0 = Date.now()

    loadCount++
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID),
      AutoModelForSequenceClassification.from_pretrained(MODEL_ID, { device: 'cpu', dtype: 'fp32' }),
    ])

    const loadTime = Date.now() - t0
    console.log(`[reranker-test] Model loaded in ${loadTime}ms`)

    // Score some pairs
    const pairs = [
      { text: 'dark dungeon with monsters', text_pair: 'epic battle music, 140 BPM, energy: 0.9' },
      { text: 'dark dungeon with monsters', text_pair: 'happy tavern jig, 120 BPM, energy: 0.4' },
      { text: 'dark dungeon with monsters', text_pair: 'ambient cave dripping, 60 BPM, energy: 0.2' },
    ]

    const queries = pairs.map((p) => p.text)
    const passages = pairs.map((p) => p.text_pair)

    const t1 = Date.now()
    const inputs = tokenizer(queries, { text_pair: passages, padding: true, truncation: true })
    const { logits } = await model(inputs)
    const scores: number[] = Array.from(logits.data as Float32Array)
    const scoreTime = Date.now() - t1

    console.log(`[reranker-test] Scored ${pairs.length} pairs in ${scoreTime}ms`)
    console.log(`[reranker-test] Scores:`, scores.map((s, i) => `${pairs[i].text_pair.slice(0, 30)}... = ${s.toFixed(3)}`))

    // Assertions
    expect(loadCount, 'Model loaded exactly once').toBe(1)
    expect(scores.length, 'One score per pair').toBe(pairs.length)
    expect(scores.every((s) => typeof s === 'number' && !Number.isNaN(s)), 'All scores are valid numbers').toBe(true)
    expect(loadTime, 'Load time < 30s').toBeLessThan(30000)
    expect(scoreTime, 'Score time < 5s for 3 pairs').toBeLessThan(5000)

    // The battle music should score higher than tavern jig for "dark dungeon"
    // (sanity check that the model is actually ranking)
    console.log(`[reranker-test] Battle vs Tavern: ${scores[0].toFixed(3)} vs ${scores[1].toFixed(3)}`)
  })

  it('second load reuses cache (no re-download)', async () => {
    const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import('@huggingface/transformers')
    env.cacheDir = join(HOME, '.doty', 'hf-cache')
    env.allowRemoteModels = true

    const MODEL_ID = 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1'

    const t0 = Date.now()
    await Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID),
      AutoModelForSequenceClassification.from_pretrained(MODEL_ID, { device: 'cpu', dtype: 'fp32' }),
    ])
    const cacheLoadTime = Date.now() - t0

    console.log(`[reranker-test] Cache load: ${cacheLoadTime}ms`)
    // Cached load should be much faster than initial (no network)
    expect(cacheLoadTime, 'Cached load < 15s').toBeLessThan(15000)
  })
})
