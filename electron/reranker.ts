import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { app } from 'electron'

export type RerankerStatus = 'loading' | 'ready' | 'error'

type Pending = {
  resolve: (scores: number[]) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let worker: Worker | null = null
let ready = false
let loadPromise: Promise<void> | null = null
let onStatus: (status: RerankerStatus) => void = () => {}
const pending = new Map<number, Pending>()
let nextId = 1

export function setOnRerankerStatus(cb: (status: RerankerStatus) => void): void {
  onStatus = cb
}

function rejectPending(err: Error): void {
  for (const [id, p] of pending) {
    clearTimeout(p.timer)
    pending.delete(id)
    p.reject(err)
  }
}

/** Tear down the current worker and reset all bookkeeping. */
function reset(err: Error): void {
  const doomed = worker
  worker = null
  ready = false
  loadPromise = null
  doomed?.terminate()
  rejectPending(err)
}

function ensureWorker(): Promise<void> {
  if (ready) return Promise.resolve()
  if (loadPromise) return loadPromise

  loadPromise = new Promise<void>((resolve, reject) => {
    const fail = (err: Error) => {
      clearTimeout(timer)
      reset(err)
      onStatus('error')
      reject(err)
    }
    const timer = setTimeout(() => fail(new Error('Reranker load timed out')), 120_000)

    onStatus('loading')
    const w = new Worker(join(__dirname, 'reranker-worker.js'), {
      workerData: { homePath: app.getPath('home') },
    })
    worker = w

    w.on('message', (msg: { type: string; id?: number; scores?: number[]; error?: string }) => {
      if (msg.type === 'ready') {
        clearTimeout(timer)
        ready = true
        onStatus('ready')
        resolve()
        return
      }
      if (msg.type === 'fatal') {
        fail(new Error(msg.error ?? 'Reranker failed to load'))
        return
      }
      if (msg.type === 'scores' || msg.type === 'score-error') {
        if (msg.id === undefined) return
        const p = pending.get(msg.id)
        if (!p) return
        clearTimeout(p.timer)
        pending.delete(msg.id)
        if (msg.type === 'scores') p.resolve(msg.scores ?? [])
        else p.reject(new Error(msg.error ?? 'Reranker failed'))
      }
    })

    // Ignore events from a worker that has already been torn down.
    w.on('error', (err) => {
      if (worker !== w) return
      if (!ready) fail(err)
      else {
        reset(err)
        onStatus('error')
      }
    })

    w.on('exit', (code) => {
      if (worker !== w) return
      if (!ready) fail(new Error(`Reranker worker exited (${code})`))
      else reset(new Error(`Reranker worker exited (${code})`))
    })
  })

  return loadPromise
}

/** Score (transcript, track description) pairs off the Electron main thread. */
export async function scorePairs(pairs: Array<{ text: string; text_pair: string }>): Promise<number[]> {
  if (pairs.length === 0) return []
  await ensureWorker()
  const id = nextId++
  return new Promise<number[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error('Reranker score timed out'))
    }, 60_000)
    pending.set(id, { resolve, reject, timer })
    worker?.postMessage({ type: 'score', id, pairs })
  })
}

export function disposeReranker(): void {
  reset(new Error('Reranker disposed'))
}
