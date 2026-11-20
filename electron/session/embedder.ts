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
 * tensors of width 512, which the graph accepts as "no media in this row".
 *
 * Audio needs two passes, which is the contract this file follows: a log-mel
 * clip ([1, frames, 128], built by `audio/mel.ts`) goes through
 * `audio_encoder_q4.onnx` to produce `[tokens, 512]` media features, and the
 * fused graph then embeds the sequence `bos <|audio> <audio|>… <audio|> eos`
 * with those features as its `audio_features` input. There is no standalone
 * audio vector; the 768-d output is the same shared space as the text path,
 * which is what makes a track comparable with a text query. The audio encoder is
 * loaded on first use, so text-only sessions never pay for it.
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
import { audioTokenCount, logMelSpectrogram } from './audio/mel'
import { normalise } from './embedding'

export const EMBEDDING_MODEL = 'embeddinggemma-2-q4'

/**
 * Vectors are keyed by the model *and* the text recipe. When what a track's
 * description says changes, the old vectors are no longer comparable with new
 * queries, so the key changes and the library is re-embedded instead of silently
 * mixing two meanings in one space.
 */
export const RETRIEVAL_KEY = `${EMBEDDING_MODEL}+facts2`
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
  /** A track's sound, in the same space as the text vectors. Null without the encoder. */
  embedAudio: ((pcm: Float32Array) => Promise<Float32Array>) | null
  dim: number
  /** Release the native sessions before the process exits. */
  dispose(): Promise<void>
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

/** The audio encoder and the config that pins its token ids. */
export function audioAvailable(dir: string): boolean {
  try {
    return ['audio_encoder_q4.onnx', 'audio_encoder_q4.onnx_data', 'config.json'].every(
      (name) => fs.statSync(join(dir, name)).size > 1024,
    )
  } catch {
    return false
  }
}

/** The fused graph's media placeholder ids, as the processor uses them. */
interface AudioTokens {
  bos: number
  boa: number
  audio: number
  eoa: number
  eos: number
}

function readAudioTokens(dir: string): AudioTokens | null {
  try {
    const config = JSON.parse(fs.readFileSync(join(dir, 'config.json'), 'utf8'))
    const tokens = {
      bos: config.text_config?.bos_token_id,
      boa: config.boa_token_id,
      audio: config.audio_token_id,
      eoa: config.eoa_token_index,
      eos: config.text_config?.eos_token_id,
    }
    return Object.values(tokens).every((id) => Number.isInteger(id)) ? (tokens as AudioTokens) : null
  } catch {
    return null
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

  const tokens = audioAvailable(dir) ? readAudioTokens(dir) : null
  let encoder: Promise<ort.InferenceSession> | null = null

  /**
   * Two passes: log-mel clip → audio encoder → media tokens → fused graph with
   * the audio placeholder sequence. The token count is not a guess: the encoder
   * keeps one token per four mel frames, and the fused graph rejects a sequence
   * whose placeholders do not match the rows it is handed.
   */
  async function embedAudio(pcm: Float32Array): Promise<Float32Array> {
    if (!tokens) throw new Error('the audio encoder is not installed')
    const mel = logMelSpectrogram(pcm)
    const count = audioTokenCount(mel.mask)
    if (count === 0) throw new Error('the clip is too short to embed')
    encoder ??= ort.InferenceSession.create(join(dir, 'audio_encoder_q4.onnx'), {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    })
    const encoded = await (await encoder).run({
      input_features: new ort.Tensor('float32', mel.data, [1, mel.frames, mel.bins]),
      input_features_mask: new ort.Tensor('bool', mel.mask, [1, mel.frames]),
    })
    const features = encoded.audio_features
    const ids = [tokens.bos, tokens.boa, ...Array<number>(count).fill(tokens.audio), tokens.eoa, tokens.eos]
    const result = await session.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      attention_mask: new ort.Tensor('int64', BigInt64Array.from(ids.map(() => 1n)), [1, ids.length]),
      image_features: noMedia(),
      video_features: noMedia(),
      audio_features: features,
    })
    return normalise(result[outputName].data as Float32Array)
  }

  return {
    dim: 768,
    embedDocuments: (texts) => Promise.all(texts.map((t) => embedOne(DOCUMENT_PREFIX, t))),
    embedQuery: (text) => embedOne(QUERY_PREFIX, text),
    embedAudio: tokens ? embedAudio : null,
    async dispose() {
      if (encoder) {
        try {
          await (await encoder).release()
        } catch {
          /* already gone */
        }
      }
      await session.release()
    },
  }
}
