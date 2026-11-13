/**
 * EmbeddingGemma-300M, text path, on onnxruntime-node.
 *
 * What an embedding run actually does, in order:
 *   1. tokenise the text (a few hundred tokens; capped at 512)
 *   2. one forward pass through a 300M-parameter encoder — this is the cost
 *   3. mean-pool the token vectors the attention mask keeps
 *   4. L2-normalise, so a dot product is a cosine
 *
 * Step 2 is why it cannot be fast: unlike the ranker, which reads 20 short
 * options once, an embedding pass is a full transformer over every token of the
 * text, and the whole library needs one pass per track. Nothing here is
 * UV-optimisable — it is matrix multiply bound.
 *
 * The model is not shipped yet; `available()` gates every caller, so an absent
 * model degrades to keyword retrieval rather than failing.
 */
import fs from 'node:fs'
import { join } from 'node:path'
import { Tokenizer } from '@huggingface/tokenizers'
import * as ort from 'onnxruntime-node'
import { meanPool, normalise } from './embedding'

export const EMBEDDING_MODEL = 'embeddinggemma-300m-q4'
const MAX_TOKENS = 512

export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>
  dim: number
}

export function embedderAvailable(dir: string): boolean {
  try {
    return fs.statSync(join(dir, 'model_q4.onnx')).size > 0 && fs.existsSync(join(dir, 'tokenizer.json'))
  } catch {
    return false
  }
}

export async function loadEmbedder(dir: string): Promise<Embedder> {
  const tokenizer = new Tokenizer(
    JSON.parse(fs.readFileSync(join(dir, 'tokenizer.json'), 'utf8')),
    JSON.parse(fs.readFileSync(join(dir, 'tokenizer_config.json'), 'utf8')),
  )
  const session = await ort.InferenceSession.create(join(dir, 'model_q4.onnx'), {
    executionProviders: ['coreml', 'cpu'],
    graphOptimizationLevel: 'all',
  })
  const outputName = session.outputNames[0]

  return {
    dim: 768,
    async embed(texts) {
      const out: Float32Array[] = []
      for (const text of texts) {
        const encoded = tokenizer.encode(text, { add_special_tokens: true })
        const ids = encoded.ids.slice(0, MAX_TOKENS)
        const mask = ids.map(() => 1)
        const feeds = {
          input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
          attention_mask: new ort.Tensor('int64', BigInt64Array.from(mask.map(BigInt)), [1, ids.length]),
        }
        const result = await session.run(feeds)
        const hidden = result[outputName].data as Float32Array
        out.push(normalise(meanPool(hidden, mask, 768)))
      }
      return out
    },
  }
}
