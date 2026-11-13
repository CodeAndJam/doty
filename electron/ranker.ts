import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { app } from 'electron'

export type RankerStatus = 'loading' | 'ready' | 'error'

type WorkerMessage = {
  type: string
  id?: number
  probabilities?: number[]
  tracks?: number[]
  moods?: number[]
  error?: string
}

type Pending = {
  resolve: (value: number[] | { tracks: number[]; moods: number[] }) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** First load reads a 1.5 GB graph; the first pass after it also warms the kernels. */
const LOAD_TIMEOUT_MS = 180_000
const DECIDE_TIMEOUT_MS = 60_000

let worker: Worker | null = null
let ready = false
let loadPromise: Promise<void> | null = null
let onStatus: (status: RankerStatus) => void = () => {}
const pending = new Map<number, Pending>()
let nextId = 1

export function setOnRankerStatus(cb: (status: RankerStatus) => void): void {
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

/** Settle the request a message answers. Unknown ids are ignored: the caller timed out. */
function settle(msg: WorkerMessage): void {
  if (msg.type !== 'probabilities' && msg.type !== 'evaluated' && msg.type !== 'decide-error') return
  if (msg.id === undefined) return
  const p = pending.get(msg.id)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(msg.id)
  if (msg.type === 'probabilities') p.resolve(msg.probabilities ?? [])
  else if (msg.type === 'evaluated') p.resolve({ tracks: msg.tracks ?? [], moods: msg.moods ?? [] })
  else p.reject(new Error(msg.error ?? 'Ranker failed'))
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
    const timer = setTimeout(() => fail(new Error('Ranker load timed out')), LOAD_TIMEOUT_MS)

    onStatus('loading')
    const w = new Worker(join(__dirname, 'ranker-worker.js'), {
      workerData: { homePath: app.getPath('home') },
    })
    worker = w

    // Ignore events from a worker that has already been torn down.
    const isCurrent = () => worker === w

    w.on('message', (msg: WorkerMessage) => {
      if (msg.type === 'ready') {
        clearTimeout(timer)
        ready = true
        onStatus('ready')
        resolve()
        return
      }
      if (msg.type === 'fatal') {
        fail(new Error(msg.error ?? 'Ranker failed to load'))
        return
      }
      settle(msg)
    })

    w.on('error', (err) => {
      if (!isCurrent()) return
      fail(err instanceof Error ? err : new Error(String(err)))
    })

    w.on('exit', (code) => {
      if (!isCurrent()) return
      fail(new Error(`Ranker worker exited (${code})`))
    })
  })

  return loadPromise
}

/** Ask the model which candidate fits the prompt, off the Electron main thread. */
export async function decide(prompt: string, candidates: string[]): Promise<number[]> {
  // A call with no candidates is the warmup: it still pays for the load, so the
  // first real recommendation never blocks on a 1.5 GB read.
  await ensureWorker()
  if (candidates.length === 0) return []
  const id = nextId++
  return new Promise<number[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error('Ranker decide timed out'))
    }, DECIDE_TIMEOUT_MS)
    pending.set(id, { resolve: resolve as Pending['resolve'], reject, timer })
    worker?.postMessage({ type: 'decide', id, prompt, candidates })
  })
}

/** Which sound effect, if any, fits this moment. Same model, stricter question. */
export async function rankSfx(state: string, candidates: string[]): Promise<number[]> {
  await ensureWorker()
  if (candidates.length === 0) return []
  const id = nextId++
  return new Promise<number[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error('SFX ranking timed out'))
    }, DECIDE_TIMEOUT_MS)
    pending.set(id, { resolve: resolve as Pending['resolve'], reject, timer })
    worker?.postMessage({ type: 'sfx', id, prompt: state, candidates })
  })
}

/** Track probabilities and the scene's mood distribution, from one model load. */
export async function evaluateSession(
  state: string,
  candidates: string[],
): Promise<{ tracks: number[]; moods: number[] }> {
  await ensureWorker()
  if (candidates.length === 0) return { tracks: [], moods: [] }
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error('Ranker evaluate timed out'))
    }, DECIDE_TIMEOUT_MS)
    pending.set(id, { resolve: resolve as Pending['resolve'], reject, timer })
    worker?.postMessage({ type: 'evaluate', id, prompt: state, candidates })
  })
}

export function disposeRanker(): void {
  reset(new Error('Ranker disposed'))
}
