/**
 * Integration test: downloads the real Qwen3-Reranker-0.6B ONNX model
 * and runs reranking to verify the pipeline works end-to-end.
 *
 * Uses a temporary cache directory that is cleaned up after each run.
 * First run downloads ~400-500 MB (may take a few minutes).
 *
 * Run with:  npx vitest run electron/qwen-integration.test.ts
 *
 * @vitest-environment node
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const MODEL_ID = 'onnx-community/Qwen3-Reranker-0.6B-ONNX'

const RERANKER_INSTRUCTION =
  'Given a spoken transcript from a tabletop RPG session, retrieve the most relevant background music or sound effect track that matches the current mood, scene, or action.'

// Create a fresh temp directory for each test run
const CACHE_DIR = mkdtempSync(join(tmpdir(), 'doty-reranker-test-'))

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

describe('Qwen3-Reranker-0.6B integration', { timeout: 600_000 }, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tokenizer: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let model: any = null
  let tokenYes = -1
  let tokenNo = -1

  beforeAll(async () => {
    console.log('[integration] temp cacheDir:', CACHE_DIR)
    const transformers = await import('@huggingface/transformers')
    const { AutoTokenizer, AutoModelForCausalLM, env } = transformers
    env.cacheDir = CACHE_DIR
    env.allowRemoteModels = true
    env.allowLocalModels = true

    console.log('[integration] loading Qwen3-Reranker-0.6B model...')
    const t0 = Date.now()

    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)
    model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
      dtype: 'q4',
      progress_callback: (p: Record<string, unknown>) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          const file = (p.file ?? p.name ?? '') as string
          console.log(`[integration] ${file} ${(p.progress as number).toFixed(1)}%`)
        } else if (p.status === 'done') {
          console.log(`[integration] ${p.file ?? p.name ?? 'file'} done`)
        }
      },
    })

    // Resolve yes/no token IDs
    tokenYes = tokenizer.convert_tokens_to_ids('yes') as number
    tokenNo = tokenizer.convert_tokens_to_ids('no') as number

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`[integration] model loaded in ${elapsed}s, tokenYes=${tokenYes}, tokenNo=${tokenNo}`)
  }, 600_000)

  afterAll(() => {
    console.log('[integration] cleaning up temp cache:', CACHE_DIR)
    try {
      rmSync(CACHE_DIR, { recursive: true, force: true })
    } catch (e) {
      console.warn('[integration] cleanup failed (non-fatal):', e)
    }
  })

  /** Score a single (query, document) pair — returns relevance probability (0-1). */
  async function scoreOne(query: string, document: string): Promise<number> {
    const prompt = buildPrompt(query, document)
    const inputs = tokenizer(prompt)
    const output = await model(inputs)
    const logits = output.logits

    const seqLen = logits.dims[1]
    const vocabSize = logits.dims[2]
    const data = logits.data as Float32Array
    const offset = (seqLen - 1) * vocabSize

    const yesLogit = data[offset + tokenYes]
    const noLogit = data[offset + tokenNo]

    const maxLogit = Math.max(yesLogit, noLogit)
    const expYes = Math.exp(yesLogit - maxLogit)
    const expNo = Math.exp(noLogit - maxLogit)
    return expYes / (expYes + expNo)
  }

  it('loads the model successfully', () => {
    expect(tokenizer).toBeTruthy()
    expect(model).toBeTruthy()
    expect(tokenYes).toBeGreaterThan(0)
    expect(tokenNo).toBeGreaterThan(0)
  })

  it('scores a relevant pair higher than an irrelevant pair', async () => {
    const relevantScore = await scoreOne(
      'We are sitting around a warm campfire telling stories',
      'Campfire, genre: ambient, energy: 0.3, danceability: 0.1',
    )
    const irrelevantScore = await scoreOne(
      'We are sitting around a warm campfire telling stories',
      'Decisive Battle Rivals, genre: metal, energy: 0.95, 180 BPM',
    )

    console.log(`[integration] relevant: ${relevantScore.toFixed(4)}, irrelevant: ${irrelevantScore.toFixed(4)}`)

    expect(relevantScore).toBeGreaterThan(irrelevantScore)
  })

  it('returns scores between 0 and 1', async () => {
    const score = await scoreOne('dark spooky dungeon', 'Horror Ambience Dark n Deep')

    console.log(`[integration] score: ${score.toFixed(4)}`)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  it('handles Portuguese transcript correctly', async () => {
    const relevantScore = await scoreOne(
      'Estamos sentados à volta da fogueira a contar histórias',
      'Campfire, genre: ambient, energy: 0.3, danceability: 0.1',
    )
    const irrelevantScore = await scoreOne(
      'Estamos sentados à volta da fogueira a contar histórias',
      'Decisive Battle Rivals, genre: metal, energy: 0.95, 180 BPM',
    )

    console.log(`[integration] PT relevant: ${relevantScore.toFixed(4)}, PT irrelevant: ${irrelevantScore.toFixed(4)}`)

    // The multilingual model should rank campfire higher for a Portuguese campfire transcript
    expect(relevantScore).toBeGreaterThan(irrelevantScore)
  })

  it('returns meaningful scores for multiple pairs', async () => {
    const scores = await Promise.all([
      scoreOne('dark spooky dungeon', 'Horror Ambience Dark n Deep'),
      scoreOne('dark spooky dungeon', 'Relaxation Panorama'),
      scoreOne('dark spooky dungeon', 'Haunted Cemetery Corrupted Innocence'),
    ])

    console.log(
      '[integration] multi-pair scores:',
      scores.map((s) => s.toFixed(4)),
    )

    expect(scores).toHaveLength(3)
    scores.forEach((s) => {
      expect(typeof s).toBe('number')
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(1)
    })

    // Horror/haunted tracks should score higher than relaxation for "dark spooky dungeon"
    const [horrorScore, relaxScore] = scores
    expect(horrorScore).toBeGreaterThan(relaxScore)
  })
})
