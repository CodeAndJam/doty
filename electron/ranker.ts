import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { Deferred, Duration, Effect, Exit, Semaphore } from 'effect'
import { app } from 'electron'

export type RankerStatus = 'loading' | 'ready' | 'error'

/** The three questions the one graph answers. */
type Question = 'decide' | 'sfx' | 'evaluate'

type Answer =
  | { type: 'probabilities'; probabilities: number[] }
  | { type: 'evaluated'; tracks: number[]; moods: number[] }

type WorkerMessage = {
  type: string
  id?: number
  probabilities?: number[]
  tracks?: number[]
  moods?: number[]
  error?: string
}

/** First load reads a 1.5 GB graph; the first pass after it also warms the kernels. */
const LOAD_TIMEOUT_MS = 180_000
const DECIDE_TIMEOUT_MS = 60_000

const TIMEOUTS: Record<Question, string> = {
  decide: 'Ranker decide timed out',
  sfx: 'SFX ranking timed out',
  evaluate: 'Ranker evaluate timed out',
}

/** One slot per in-flight request, settled by the worker's answer. */
const pending = new Map<number, Deferred.Deferred<Answer, Error>>()
let nextId = 1

let worker: Worker | null = null
let ready = false
let loadPromise: Promise<void> | null = null
let onStatus: (status: RankerStatus) => void = () => {}

/**
 * One forward pass at a time. Without it the 60 s deadline could start before
 * the worker reached the question, and a caller would wait out a queue it was
 * never told about. A caller's deadline now starts when its slot is acquired.
 */
let gate: Semaphore.Semaphore | null = null
const permit = () => {
  gate ??= Effect.runSync(Semaphore.make(1))
  return gate
}

export function setOnRankerStatus(cb: (status: RankerStatus) => void): void {
  onStatus = cb
}

function failPending(err: Error): void {
  for (const [id, slot] of pending) {
    pending.delete(id)
    Deferred.doneUnsafe(slot, Exit.fail(err))
  }
}

/** Tear down the current worker and reset all bookkeeping. */
function reset(err: Error): void {
  const doomed = worker
  worker = null
  ready = false
  loadPromise = null
  doomed?.terminate()
  failPending(err)
}

/** Settle the request a message answers. Unknown ids are ignored: the caller timed out. */
function settle(msg: WorkerMessage): void {
  if (msg.id === undefined) return
  const slot = pending.get(msg.id)
  if (!slot) return
  pending.delete(msg.id)
  if (msg.type === 'probabilities') {
    Deferred.doneUnsafe(slot, Exit.succeed({ type: 'probabilities', probabilities: msg.probabilities ?? [] }))
  } else if (msg.type === 'evaluated') {
    Deferred.doneUnsafe(slot, Exit.succeed({ type: 'evaluated', tracks: msg.tracks ?? [], moods: msg.moods ?? [] }))
  } else {
    Deferred.doneUnsafe(slot, Exit.fail(new Error(msg.error ?? 'Ranker failed')))
  }
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

/**
 * Ask one question, off the Electron main thread, behind the single-pass gate.
 * The deadline covers the forward pass, not the time spent waiting for it.
 */
function ask<A>(question: Question, prompt: string, candidates: string[], read: (answer: Answer) => A) {
  return Effect.gen(function* () {
    yield* Effect.promise(() => ensureWorker())
    const answer = yield* permit().withPermit(
      Effect.gen(function* () {
        const id = nextId++
        const slot = yield* Deferred.make<Answer, Error>()
        pending.set(id, slot)
        worker?.postMessage({ type: question, id, prompt, candidates })
        return yield* Deferred.await(slot).pipe(
          // A dead worker fails every pending slot, so this is the only deadline.
          Effect.timeout(Duration.millis(DECIDE_TIMEOUT_MS)),
          Effect.mapError(() => new Error(TIMEOUTS[question])),
          Effect.ensuring(Effect.sync(() => pending.delete(id))),
        )
      }),
    )
    return read(answer)
  })
}

/** Ask the model which candidate fits the prompt, off the Electron main thread. */
export async function decide(prompt: string, candidates: string[]): Promise<number[]> {
  // A call with no candidates is the warmup: it still pays for the load, so the
  // first real recommendation never blocks on a 1.5 GB read.
  if (candidates.length === 0) {
    await ensureWorker()
    return []
  }
  return Effect.runPromise(
    ask('decide', prompt, candidates, (answer) => (answer.type === 'probabilities' ? answer.probabilities : [])),
  )
}

/** Which sound effect, if any, fits this moment. Same model, stricter question. */
export async function rankSfx(state: string, candidates: string[]): Promise<number[]> {
  if (candidates.length === 0) {
    await ensureWorker()
    return []
  }
  return Effect.runPromise(
    ask('sfx', state, candidates, (answer) => (answer.type === 'probabilities' ? answer.probabilities : [])),
  )
}

/** Track probabilities and the scene's mood distribution, from one model load. */
export async function evaluateSession(
  state: string,
  candidates: string[],
): Promise<{ tracks: number[]; moods: number[] }> {
  if (candidates.length === 0) {
    await ensureWorker()
    return { tracks: [], moods: [] }
  }
  return Effect.runPromise(
    ask('evaluate', state, candidates, (answer) =>
      answer.type === 'evaluated' ? { tracks: answer.tracks, moods: answer.moods } : { tracks: [], moods: [] },
    ),
  )
}

/**
 * Ask the worker to finish its current forward pass and leave. Terminating a
 * thread mid-Run aborts the whole process inside onnxruntime.
 */
export async function disposeRanker(): Promise<void> {
  const w = worker
  if (!w) return
  worker = null
  ready = false
  loadPromise = null
  failPending(new Error('Ranker disposed'))
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      // Still loading or mid-run. Terminating a worker in that state aborts the
      // process inside onnxruntime; the process exits by SIGKILL after this, and
      // the thread goes with it without running the finalizer.
      resolve()
    }, 3_000)
    w.once('message', (msg: WorkerMessage) => {
      if (msg.type !== 'closed') return
      clearTimeout(timer)
      w.terminate()
      resolve()
    })
    w.postMessage({ type: 'close' })
  })
}
