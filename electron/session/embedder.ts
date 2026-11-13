/**
 * EmbeddingGemma-300M, text path, on onnxruntime-node.
 *
 * What an embedding run actually does, in order:
 *   1. tokenise the text (a few hundred tokens; capped at 512)
 *   2. one forward pass through a 300M-parameter encoder — this is the cost
 *   3. mean-pool the token vectors the attention mask keeps
 *   4. L2-normalise, so a dot product is a cosine
 *
 * Version 2 is one fused graph: it also declares image, video and audio inputs,
 * and refuses to run without them. Text-only therefore means passing empty media
 * tensors of width 512, which the graph accepts as "no media in this row". The
 * audio path lives in its own graph (`audio_encoder_q4.onnx`) and is not wired
 * yet — its mel contract is 128 bins over frames, which needs validating against
 * a real track before it can be trusted.
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
import { normalise } from './embedding'

export const EMBEDDING_MODEL = 'embeddinggemma-2-q4'
const MAX_TOKENS = 8192

/** Width the v2 graph expects for a media token. */
const MEDIA_DIM = 512

/**
 * EmbeddingGemma is trained with task prefixes: a query and a document are
 * embedded differently, and skipping them measurably costs retrieval quality.
 */
const QUERY_PREFIX = 'task: search result | query: '
const DOCUMENT_PREFIX = 'title: none | text: '

export interface Embedder {
  /** Documents to be found later. */
  embedDocuments(texts: string[]): Promise<Float32Array[]>
  /** A search query: the transcript. */
  embedQuery(text: string): Promise<Float32Array>
  dim: number
}

/**
 * Every file the session needs, checked by presence and plausibility rather than
 * by hash: the check runs at startup, and hashing 197 MB on a cold launch is a
 * pause the user would feel. Nothing is ever re-downloaded while these exist.
 */
export function embedderAvailable(dir: string): boolean {
  try {
    // The audio encoder is optional: retrieval works without it.
    return ['model_q4.onnx', 'model_q4.onnx_data', 'tokenizer.json', 'tokenizer_config.json'].every(
      (name) => fs.statSync(join(dir, name)).size > 1024,
    )
  } catch {
    return false
  }
}

export async function loadEmbedder(dir: string): Promise<Embedder> {
  const tokenizer = new Tokenizer(
    JSON.parse(fs.readFileSync(join(dir, 'tokenizer.json'), 'utf8')),
    JSON.parse(fs.readFileSync(join(dir, 'tokenizer_config.json'), 'utf8')),
  )
  // CPU on purpose: CoreML refuses zero-element tensors, and the fused graph only
  // runs text-only when its media inputs are empty. Indexing is background work and
  // a query is one short pass, so the GPU buys nothing worth faking a media token.
  const session = await ort.InferenceSession.create(join(dir, 'model_q4.onnx'), {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  })
  // The export pools for us and emits the pooled vector directly; mean-pooling
  // last_hidden_state again would double-pool and blur the result.
  const outputName = session.outputNames.includes('sentence_embedding') ? 'sentence_embedding' : session.outputNames[0]

  /** Empty media rows: the fused graph requires the inputs, not their content. */
  const noMedia = () => new ort.Tensor('float32', new Float32Array(0), [0, MEDIA_DIM])

  async function embedOne(prefix: string, text: string): Promise<Float32Array> {
    const encoded = tokenizer.encode(prefix + text, { add_special_tokens: true })
    const ids = encoded.ids.slice(0, MAX_TOKENS)
    const feeds = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      attention_mask: new ort.Tensor('int64', BigInt64Array.from(ids.map(() => 1n)), [1, ids.length]),
      image_features: noMedia(),
      video_features: noMedia(),
      audio_features: noMedia(),
    }
    const result = await session.run(feeds)
    return normalise(result[outputName].data as Float32Array)
  }

  return {
    dim: 768,
    embedDocuments: (texts) => Promise.all(texts.map((t) => embedOne(DOCUMENT_PREFIX, t))),
    embedQuery: (text) => embedOne(QUERY_PREFIX, text),
  }
}
