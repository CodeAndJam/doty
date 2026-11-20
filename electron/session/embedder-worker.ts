/**
 * The embedder, in its own process.
 *
 * onnxruntime's native sessions cannot be released safely at exit: releasing the
 * 300M encoder from the main process printed a `Napi::Error` abort from its
 * finaliser on quit (TODO.md). A utility process is killed rather than
 * finalised, so the abort has nothing left to abort, and the encoder's memory
 * leaves with it.
 *
 * This file is an entry point, not a module: it owns one model and answers
 * requests from `embedder-client.ts` over `parentPort`.
 */
import { loadEmbedder } from './embedder'
import type { Embedder } from './embedder-files'

type Request = {
  id: number
  kind: 'documents' | 'query' | 'audio' | 'dispose'
  /** Sent with the first request; the model is loaded for this directory. */
  dir?: string
  texts?: string[]
  text?: string
  pcm?: Float32Array
}

type Reply = { id: number; ok: true; value?: unknown } | { id: number; ok: false; error: string }

const port = process.parentPort
let model: Embedder | null = null
let modelDir: string | null = null

function reply(message: Reply): void {
  port.postMessage(message)
}

async function embedding(dir: string): Promise<Embedder> {
  if (model && modelDir === dir) return model
  await model?.dispose().catch(() => {})
  model = await loadEmbedder(dir)
  modelDir = dir
  console.log('[embedder] model loaded in the utility process')
  return model
}

async function answer(request: Request): Promise<unknown> {
  if (request.kind === 'dispose') {
    await model?.dispose().catch(() => {})
    model = null
    modelDir = null
    return undefined
  }
  if (!request.dir) throw new Error('the embedder has not been told which model to load')
  const embedder = await embedding(request.dir)

  switch (request.kind) {
    case 'documents':
      return embedder.embedDocuments(request.texts ?? [])
    case 'query':
      return embedder.embedQuery(request.text ?? '')
    case 'audio': {
      if (!embedder.embedAudio) throw new Error('the audio encoder is not installed')
      return embedder.embedAudio(request.pcm ?? new Float32Array(0))
    }
  }
}

port.on('message', (event) => {
  const request = event.data as Request
  answer(request)
    .then((value) => reply({ id: request.id, ok: true, value }))
    .catch((err: unknown) =>
      reply({ id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) }),
    )
})
