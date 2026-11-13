/**
 * The background indexer.
 *
 * Embedding a library is minutes of work, not milliseconds: every track needs a
 * model forward pass. So it runs in batches, resumes where it stopped, and never
 * holds the app up. Whatever is already in the store is skipped, which makes it
 * safe to stop at any point — closing the app mid-index costs nothing but the
 * unfinished batch.
 */

export interface IndexerStore {
  getVector(path: string, model: string): Float32Array | null
  putVector(path: string, model: string, vector: Float32Array): void
}

export interface IndexerDeps {
  /** Current library contents, read fresh each run. */
  paths: () => string[]
  store: IndexerStore
  /** Embeds a batch of descriptions; one forward pass per text. */
  embed: (texts: string[]) => Promise<Float32Array[]>
  model: string
  /** The text the model sees for a track. */
  describe: (path: string) => string
  batch?: number
  onProgress?: (progress: { done: number; total: number }) => void
}

export interface Indexer {
  run(): Promise<void>
}

export function createIndexer(deps: IndexerDeps): Indexer {
  const batch = Math.max(1, deps.batch ?? 8)

  return {
    async run() {
      const pending = deps.paths().filter((path) => deps.store.getVector(path, deps.model) === null)
      if (pending.length === 0) return
      const total = pending.length
      let done = 0

      for (let start = 0; start < pending.length; start += batch) {
        const slice = pending.slice(start, start + batch)
        // A failure aborts the run; everything stored so far stays stored, so the
        // next run resumes from here rather than starting over.
        const vectors = await deps.embed(slice.map(deps.describe))
        slice.forEach((path, i) => {
          const vector = vectors[i]
          if (vector) deps.store.putVector(path, deps.model, vector)
        })
        done += slice.length
        deps.onProgress?.({ done, total })
      }
    },
  }
}
