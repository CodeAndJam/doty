/**
 * The audio kind pass: one embedding per track, kept, so a restart classifies
 * from the stored vector instead of decoding the file again.
 *
 * Same shape as the text indexer next door — batched, resumable, never blocking —
 * but the expensive part is ffmpeg plus two graph passes, so a failure on one
 * track skips it rather than aborting the run. Anything not classified has no
 * entry in `kinds`, and the caller falls back to duration.
 */
import type { AudioKind } from '../kindDecision'
import { AUDIO_EMBEDDING_KEY } from './track'

export interface AudioIndexerStore {
  getVector(path: string, model: string): Float32Array | null
  putVector(path: string, model: string, vector: Float32Array): void
}

export interface AudioIndexerDeps {
  paths: () => string[]
  store: AudioIndexerStore
  /** Decode and embed one file; null when the file cannot be read or embedded. */
  embed: (path: string) => Promise<Float32Array | null>
  classify: (vector: Float32Array) => AudioKind
  onProgress?: (progress: { done: number; total: number }) => void
}

export interface AudioIndexer {
  /** Every verdict from this run, by path. Reads are cheap after the first pass. */
  kinds: Record<string, AudioKind>
  run(): Promise<void>
}

export function createAudioIndexer(deps: AudioIndexerDeps): AudioIndexer {
  const kinds: Record<string, AudioKind> = {}

  /** Stored vector if there is one, otherwise a fresh embedding, otherwise null. */
  async function vectorFor(path: string): Promise<Float32Array | null> {
    const stored = deps.store.getVector(path, AUDIO_EMBEDDING_KEY)
    if (stored) return stored
    let vector: Float32Array | null = null
    try {
      vector = await deps.embed(path)
    } catch {
      return null
    }
    if (vector) deps.store.putVector(path, AUDIO_EMBEDDING_KEY, vector)
    return vector
  }

  return {
    kinds,
    async run() {
      const paths = deps.paths()
      let done = 0
      for (const path of paths) {
        const vector = await vectorFor(path)
        if (vector) kinds[path] = deps.classify(vector)
        done++
        deps.onProgress?.({ done, total: paths.length })
      }
    },
  }
}
