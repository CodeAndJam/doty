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

const REQUEST_TIMEOUT_MS = 300_000

type Reply = { id: number; ok: boolean; value?: unknown; error?: string }

export interface EmbedderOptions {
  /** Whether the audio encoder is installed; decides `embedAudio`. */
  audio: boolean
  /** Called when the process dies, so the caller can reload on the next pass. */
  onExit?: () => void
}

export async function createEmbedder(dir: string, options: EmbedderOptions): Promise<Embedder> {
  const child = utilityProcess.fork(join(__dirname, 'embedder-worker.js'), [], { serviceName: 'Doty Embedder' })
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >()
  let nextId = 1
  let closed = false

  const failAll = (message: string) => {
    closed = true
    for (const [id, entry] of pending) {
      pending.delete(id)
      clearTimeout(entry.timer)
      entry.reject(new Error(message))
    }
  }

  child.on('message', (raw: unknown) => {
    const reply = raw as Reply
    const entry = pending.get(reply.id)
    if (!entry) return
    pending.delete(reply.id)
    clearTimeout(entry.timer)
    if (reply.ok) entry.resolve(reply.value)
    else entry.reject(new Error(reply.error ?? 'the embedder failed'))
  })
  child.on('exit', () => {
    failAll('the embedder process exited')
    options.onExit?.()
  })

  function send(kind: 'documents' | 'query' | 'audio' | 'dispose', payload: Record<string, unknown> = {}) {
    if (closed) return Promise.reject(new Error('the embedder process has exited'))
    const id = nextId++
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`the embedder did not answer ${kind}`))
      }, REQUEST_TIMEOUT_MS)
      pending.set(id, { resolve, reject, timer })
      child.postMessage({ id, kind, dir, ...payload })
    })
  }

  const documents = async (texts: string[]) => (await send('documents', { texts })) as Float32Array[]
  const query = async (text: string) => (await send('query', { text })) as Float32Array
  const audio = async (pcm: Float32Array) => (await send('audio', { pcm })) as Float32Array

  await send('documents', { texts: [] })

  return {
    dim: 768,
    embedDocuments: documents,
    embedQuery: query,
    embedAudio: options.audio ? audio : null,
    async dispose() {
      if (closed) return
      try {
        await send('dispose')
      } catch {
        // A dead process has already released the model with it.
      }
      closed = true
      child.kill()
    },
  }
}
