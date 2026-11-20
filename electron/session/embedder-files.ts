import fs from 'node:fs'
import { join } from 'node:path'

export const EMBEDDING_MODEL = 'embeddinggemma-2-q4'

/**
 * Vectors are keyed by the model *and* the text recipe. When what a track's
 * description says changes, the old vectors are no longer comparable with new
 * queries, so the key changes and the library is re-embedded instead of silently
 * mixing two meanings in one space.
 */
export const RETRIEVAL_KEY = `${EMBEDDING_MODEL}+facts2`
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
