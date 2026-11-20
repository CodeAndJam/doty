import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { Deferred, Duration, Effect, Exit, Option } from 'effect'
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
const QUESTION_TIMEOUT_MS = 60_000

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
 * Requests per question, newest last, one drain loop. A pass takes ~4.4 s and
 * the recommendation cadence is ~2 s, so serialising alone still runs every
 * queued pass and the backlog grows. A request that arrives while one of the
 * same question is queued and offers the same option list replaces its prompt
 * and joins its replies: the indices still line up, and the answer is for what
 * the table is doing now rather than for a state the pass has outlived.
 */
type Job = { prompt: string; candidates: string[]; replies: Array<Deferred.Deferred<Answer, Error>> }

const queued = new Map<Question, Job[]>()
let draining = false
/** Set while the worker is being torn down: a job must not fork a new one. */
let disposing = false

const sameCandidates = (a: string[], b: string[]) => a.length === b.length && a.every((value, i) => value === b[i])

function nextJob(): { question: Question; job: Job } | null {
  for (const [question, jobs] of queued) {
    const job = jobs.shift()
    if (!job) {
      queued.delete(question)
      continue
    }
    // Round-robin: a question that keeps arriving must not starve the others.
    if (jobs.length === 0) queued.delete(question)
    else {
      queued.delete(question)
      queued.set(question, jobs)
    }
    return { question, job }
  }
  return null
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

/** Queue one question, joining the newest batch of the same shape. */
function ask<A>(question: Question, prompt: string, candidates: string[], read: (answer: Answer) => A) {
  return Effect.gen(function* () {
    const reply = yield* Deferred.make<Answer, Error>()
    const jobs = queued.get(question) ?? []
    const last = jobs[jobs.length - 1]
    if (last && sameCandidates(last.candidates, candidates)) {
      last.prompt = prompt
      last.replies.push(reply)
    } else {
      jobs.push({ prompt, candidates, replies: [reply] })
      queued.set(question, jobs)
    }
    if (!draining) void drain()
    return read(yield* Deferred.await(reply))
  })
}

/**
 * The single pass. The deadline covers the forward pass, not the wait behind
 * another one; a worker that died while this job waited fails every reply now
 * instead of holding the queue for the deadline.
 */
function runJob(question: Question, job: Job) {
  return Effect.gen(function* () {
    if (disposing) return yield* Effect.fail(new Error('Ranker disposed'))
    yield* Effect.promise(() => ensureWorker())
    const active = worker
    if (!active) return yield* Effect.fail(new Error('Ranker is not running'))
    const id = nextId++
    const slot = yield* Deferred.make<Answer, Error>()
    pending.set(id, slot)
    active.postMessage({ type: question, id, prompt: job.prompt, candidates: job.candidates })
    return yield* Deferred.await(slot).pipe(
      // A dead worker fails every pending slot; only a silent one needs this.
      Effect.timeoutOption(Duration.millis(QUESTION_TIMEOUT_MS)),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new Error(TIMEOUTS[question])),
          onSome: Effect.succeed,
        }),
      ),
      Effect.ensuring(Effect.sync(() => pending.delete(id))),
    )
  })
}

async function drain(): Promise<void> {
  draining = true
  try {
    for (;;) {
      const next = nextJob()
      if (!next) return
      const exit = await Effect.runPromise(Effect.exit(runJob(next.question, next.job)))
      // One answer settles the whole batch. A caller left unsettled here would
      // wait for the life of the app: there is no second deadline behind this.
      for (const reply of next.job.replies) Deferred.doneUnsafe(reply, exit)
    }
  } finally {
    draining = false
  }
}

/** Fail every queued job, so a dispose cannot be followed by a fresh load. */
function failQueued(err: Error): void {
  for (const [question, jobs] of queued) {
    queued.delete(question)
    for (const job of jobs) for (const reply of job.replies) Deferred.doneUnsafe(reply, Exit.fail(err))
  }
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
  const disposed = new Error('Ranker disposed')
  // Nothing may start a load from here on: the drain loop may still be between
  // jobs, and a job that lands during the teardown would fork a fresh worker for
  // the model the caller is deleting.
  disposing = true
  failQueued(disposed)
  const w = worker
  if (!w) {
    disposing = false
    return
  }
  worker = null
  ready = false
  loadPromise = null
  failPending(disposed)
  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        // Still loading or mid-run. Terminating a worker in that state aborts the
        // process inside onnxruntime; the process exits by SIGKILL after this, and
        // the thread goes with it without running the finalizer.
        resolve()
      }, 3_000)
      // An answer already in flight must not be mistaken for the `closed` frame.
      const onMessage = (msg: WorkerMessage) => {
        if (msg.type !== 'closed') return
        clearTimeout(timer)
        w.off('message', onMessage)
        w.terminate()
        resolve()
      }
      w.on('message', onMessage)
      w.postMessage({ type: 'close' })
    })
  } finally {
    disposing = false
  }
}
