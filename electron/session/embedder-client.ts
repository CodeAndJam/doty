/**
 * The main-process handle on the embedder utility process.
 *
 * Same interface as the in-process module (`Embedder`), so the library and the
 * indexer never learn where the model lives. The process is forked on first use
 * and killed on quit: onnxruntime cannot unload safely inside Electron's main
 * process, which is what the `Napi::Error` abort on quit was.
 */
import { join } from 'node:path'
import { utilityProcess } from 'electron'
import type { Embedder } from './embedder-files'
import type { EmbedderCapability, EmbedderReply, EmbedderRequest } from './embedder-protocol'

const REQUEST_TIMEOUT_MS = 300_000
/** The process is being killed anyway; a graceful dispose must not outlast a quit. */
const DISPOSE_TIMEOUT_MS = 3_000

export interface CreateEmbedderOptions {
  /** Called with the handle when the process dies, so the caller can drop it. */
  onExit?: (embedder: Embedder) => void
}

export async function createEmbedder(dir: string, options: CreateEmbedderOptions = {}): Promise<Embedder> {
  const child = utilityProcess.fork(join(__dirname, 'embedder-worker.js'), [], { serviceName: 'Doty Embedder' })
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >()
  let nextId = 1
  let closed = false
  /** Set while the model is being disposed: new work would reload it. */
  let closing = false
  let self: Embedder | null = null

  const failAll = (message: string) => {
    closed = true
    for (const [id, entry] of pending) {
      pending.delete(id)
      clearTimeout(entry.timer)
      entry.reject(new Error(message))
    }
  }

  child.on('message', (raw: unknown) => {
    const reply = raw as EmbedderReply
    const entry = pending.get(reply.id)
    if (!entry) return
    pending.delete(reply.id)
    clearTimeout(entry.timer)
    if (reply.ok) entry.resolve(reply.value)
    else entry.reject(new Error(reply.error))
  })
  child.on('exit', () => {
    failAll('the embedder process exited')
    // A child that died before the handshake never became a handle: the caller
    // is about to get the handshake's error instead, so there is nothing to drop.
    if (self) options.onExit?.(self)
  })

  function send(
    kind: EmbedderRequest['kind'],
    payload: Record<string, unknown> = {},
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    if (closed) return Promise.reject(new Error('the embedder process has exited'))
    if (closing && kind !== 'dispose') return Promise.reject(new Error('the embedder is being disposed'))
    const id = nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`the embedder did not answer ${kind}`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        child.postMessage({ id, kind, dir, ...payload })
      } catch (err) {
        // A port that is already closing must not leak the slot and its timer.
        pending.delete(id)
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  let capability: EmbedderCapability
  try {
    // The handshake loads the model, so a model that cannot load fails here,
    // with the child killed, rather than leaking one process per retry.
    capability = (await send('load')) as EmbedderCapability
  } catch (err) {
    closed = true
    child.kill()
    throw err
  }

  const documents = async (texts: string[]) => (await send('documents', { texts })) as Float32Array[]
  const query = async (text: string) => (await send('query', { text })) as Float32Array
  const audio = async (pcm: Float32Array) => (await send('audio', { pcm })) as Float32Array

  const embedder: Embedder = {
    dim: capability.dim,
    embedDocuments: documents,
    embedQuery: query,
    // The worker loaded the model, so it is the side that knows whether the
    // audio encoder is usable.
    embedAudio: capability.audio ? audio : null,
    async dispose() {
      if (closed) return
      // Refuse new work first: the worker drops its model as soon as it sees
      // this, and a request arriving behind it would load 300 MB to be killed.
      closing = true
      try {
        await send('dispose', {}, DISPOSE_TIMEOUT_MS)
      } catch {
        // A hung or dead worker is killed below either way.
      }
      failAll('the embedder was disposed')
      child.kill()
    },
  }
  self = embedder
  return embedder
}
