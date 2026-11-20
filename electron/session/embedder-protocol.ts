/**
 * The embedder's wire protocol, independent of Electron.
 *
 * The process entry owns `parentPort` and the model; everything worth testing —
 * dispatch, the model cache, the capability handshake, error replies — lives
 * here and takes its loader as a dependency, the way `policy.ts` takes its clock.
 */
import type { Embedder } from './embedder-files'

export type EmbedderRequest =
  | { id: number; kind: 'load'; dir: string }
  | { id: number; kind: 'documents'; dir: string; texts: string[] }
  | { id: number; kind: 'query'; dir: string; text: string }
  | { id: number; kind: 'audio'; dir: string; pcm: Float32Array }
  | { id: number; kind: 'dispose' }

export type EmbedderReply = { id: number; ok: true; value?: unknown } | { id: number; ok: false; error: string }

/** What the model can do, decided by the side that loaded it. */
export interface EmbedderCapability {
  dim: number
  /** False when the audio encoder is installed but unreadable. */
  audio: boolean
}

export interface EmbedderHandler {
  handle(request: EmbedderRequest): Promise<EmbedderReply>
}

export function createEmbedderHandler(load: (dir: string) => Promise<Embedder>): EmbedderHandler {
  // Cache inputs: `model` + `modelDir`. It ends on a different directory, on
  // `dispose`, or when the load that produced it fails (the model is nulled
  // before loading, so a failed load cannot leave a disposed handle behind).
  let model: Embedder | null = null
  let modelDir: string | null = null
  /** Two first requests used to load two 300M models; they join this instead. */
  let loading: { promise: Promise<Embedder> } | null = null

  async function modelFor(dir: string): Promise<Embedder> {
    if (model && modelDir === dir) return model
    if (loading) {
      // A load is in flight: wait for it, then look again. A different
      // directory replaces the model below, one load at a time.
      await loading.promise.catch(() => {})
      if (model && modelDir === dir) return model
    }
    const current = (async () => {
      const previous = model
      model = null
      modelDir = dir
      await previous?.dispose().catch(() => {})
      const next = await load(dir)
      model = next
      console.log('[embedder] model loaded in the utility process')
      return next
    })()
    loading = { promise: current }
    try {
      return await current
    } finally {
      // Only the load that is still current may clear the memo.
      if (loading?.promise === current) loading = null
    }
  }

  return {
    async handle(request) {
      if (request.kind === 'dispose') {
        // Capture and clear before awaiting: two disposals must not release the
        // same native session twice.
        const doomed = model
        model = null
        modelDir = null
        await doomed?.dispose().catch(() => {})
        return { id: request.id, ok: true }
      }

      try {
        const embedder = await modelFor(request.dir)
        if (request.kind === 'load') {
          return { id: request.id, ok: true, value: { dim: embedder.dim, audio: embedder.embedAudio !== null } }
        }
        if (request.kind === 'documents') {
          return { id: request.id, ok: true, value: await embedder.embedDocuments(request.texts) }
        }
        if (request.kind === 'query') {
          return { id: request.id, ok: true, value: await embedder.embedQuery(request.text) }
        }
        if (!embedder.embedAudio) throw new Error('the audio encoder is not installed')
        return { id: request.id, ok: true, value: await embedder.embedAudio(request.pcm) }
      } catch (err) {
        return { id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
