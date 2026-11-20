import { describe, expect, it, vi } from 'vitest'

/**
 * The supervisor's two guarantees are about the worker, not about Effect:
 * one forward pass at a time, and a caller that waited for the slot fails at
 * once if the worker died while it waited. A real Worker would need a 1.5 GB
 * graph, so the thread is faked at the module seam.
 */
const fake = vi.hoisted(() => {
  type Listener = (value: unknown) => void

  class FakeWorker {
    static latest: FakeWorker | null = null
    private listeners = new Map<string, Listener[]>()
    posted: Array<{ type: string; id?: number }> = []
    /** While true, a posted question is recorded but not answered. */
    hold = true
    /** While false, `close` is recorded and the test answers it. */
    autoClose = true
    terminated = false

    constructor() {
      FakeWorker.latest = this
      // After the handlers are attached, as a real worker's `ready` would be.
      setTimeout(() => this.emit('message', { type: 'ready' }), 0)
    }

    on(event: string, listener: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    }

    off(event: string, listener: Listener) {
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter((entry) => entry !== listener),
      )
    }

    postMessage(message: { type: string; id?: number }) {
      this.posted.push(message)
      if (message.type === 'close') {
        if (this.autoClose) setTimeout(() => this.emit('message', { type: 'closed' }), 0)
        return
      }
      if (!this.hold) this.answer(message)
    }

    answer(message: { type: string; id?: number }) {
      setTimeout(() => {
        if (message.type === 'evaluate') {
          this.emit('message', { type: 'evaluated', id: message.id, tracks: [1], moods: [1] })
        } else {
          this.emit('message', { type: 'probabilities', id: message.id, probabilities: [0.5] })
        }
      }, 0)
    }

    emit(event: string, value: unknown) {
      for (const listener of this.listeners.get(event) ?? []) listener(value)
    }

    terminate() {
      this.terminated = true
    }
  }

  return { FakeWorker }
})

vi.mock('node:worker_threads', () => ({ Worker: fake.FakeWorker }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

/** Wait for a condition instead of sleeping: the suite runs files in parallel. */
async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the fake worker')
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

/** A short pause for negative assertions: one batch must be all that is queued. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const decidePosts = () => fake.FakeWorker.latest?.posted.filter((message) => message.type === 'decide') ?? []

async function load() {
  fake.FakeWorker.latest = null
  vi.resetModules()
  return import('./ranker')
}

describe('ranker supervisor', () => {
  it('runs one forward pass at a time', async () => {
    const ranker = await load()

    const first = ranker.decide('first', ['x'])
    await waitFor(() => decidePosts().length === 1)
    const second = ranker.decide('second', ['x'])
    await settle()

    const worker = fake.FakeWorker.latest!
    expect(decidePosts()).toHaveLength(1)

    worker.hold = false
    worker.answer(worker.posted[0])
    await expect(first).resolves.toEqual([0.5])
    await waitFor(() => decidePosts().length === 2)

    worker.answer(worker.posted[1])
    await expect(second).resolves.toEqual([0.5])

    await ranker.disposeRanker()
  })

  it('coalesces a queued question from the same option list', async () => {
    const ranker = await load()

    const first = ranker.decide('first', ['x'])
    await waitFor(() => decidePosts().length === 1)
    const second = ranker.decide('second', ['x'])
    const third = ranker.decide('third', ['x'])
    await settle()
    // Same options: the two queued callers share one batch.
    expect(decidePosts()).toHaveLength(1)

    const worker = fake.FakeWorker.latest!
    worker.hold = false
    worker.answer(worker.posted[0])
    await expect(first).resolves.toEqual([0.5])
    await waitFor(() => decidePosts().length === 2)
    worker.answer(worker.posted[1])

    // One pass for the two of them, and the newest prompt is the one asked.
    await expect(second).resolves.toEqual([0.5])
    await expect(third).resolves.toEqual([0.5])
    expect(decidePosts()).toHaveLength(2)
    expect((worker.posted[1] as { prompt?: string }).prompt).toBe('third')

    await ranker.disposeRanker()
  })

  it('rejects queued callers on dispose without starting another worker', async () => {
    const ranker = await load()

    const first = ranker.decide('first', ['x'])
    await waitFor(() => decidePosts().length === 1)
    const queued = ranker.decide('second', ['x'])
    await settle()
    const dead = fake.FakeWorker.latest!

    // Attach the expectations before disposing: both promises reject while
    // `disposeRanker` is awaited, and an unobserved rejection is an error here.
    const firstFailed = expect(first).rejects.toThrow(/disposed|exited/)
    const queuedFailed = expect(queued).rejects.toThrow(/disposed/)
    await ranker.disposeRanker()
    // Check identity first: awaiting the rejection first would let a re-fork
    // pass this test by timing out instead.
    expect(fake.FakeWorker.latest).toBe(dead)
    await firstFailed
    await queuedFailed
  })

  it('serves a waiting effects question before a later decide', async () => {
    const ranker = await load()

    const first = ranker.decide('first', ['x'])
    await waitFor(() => decidePosts().length === 1)
    // Arrival order decides: one waiting job per question, so nothing can starve.
    const sfx = ranker.rankSfx('a roar', ['z'])
    const second = ranker.decide('second', ['y'])
    await settle()

    const worker = fake.FakeWorker.latest!
    worker.hold = false
    worker.answer(worker.posted[0])
    await expect(first).resolves.toEqual([0.5])

    await waitFor(() => worker.posted.length === 2)
    expect((worker.posted[1] as { type: string }).type).toBe('sfx')
    worker.answer(worker.posted[1])
    await expect(sfx).resolves.toEqual([0.5])

    await waitFor(() => worker.posted.length === 3)
    worker.answer(worker.posted[2])
    await expect(second).resolves.toEqual([0.5])

    await ranker.disposeRanker()
  })

  it('replaces a waiting job whose options changed and fails its caller', async () => {
    const ranker = await load()

    const first = ranker.decide('first', ['x'])
    await waitFor(() => decidePosts().length === 1)
    const second = ranker.decide('second', ['y'])
    const secondFailed = expect(second).rejects.toThrow('superseded')
    // A newer scene with different options: the waiting job is replaced rather
    // than queued behind, or the pass would describe a scene that is over.
    const third = ranker.decide('third', ['z'])
    await settle()

    const worker = fake.FakeWorker.latest!
    worker.hold = false
    worker.answer(worker.posted[0])
    await expect(first).resolves.toEqual([0.5])
    await secondFailed

    await waitFor(() => decidePosts().length === 2)
    expect((worker.posted[1] as { prompt?: string }).prompt).toBe('third')
    worker.answer(worker.posted[1])
    await expect(third).resolves.toEqual([0.5])
    expect(decidePosts()).toHaveLength(2)

    await ranker.disposeRanker()
  })

  it('waits for the teardown it joined, and refuses work meanwhile', async () => {
    const ranker = await load()
    const first = ranker.decide('first', ['x'])
    await waitFor(() => decidePosts().length === 1)
    const worker = fake.FakeWorker.latest!
    worker.autoClose = false

    const firstFailed = expect(first).rejects.toThrow(/disposed|exited/)
    const owner = ranker.disposeRanker()
    // A second dispose must wait for the first, not return early and reopen the
    // window while the worker is still closing.
    const bystander = ranker.disposeRanker()
    await expect(ranker.decide('late', ['y'])).rejects.toThrow(/disposed/)
    expect(fake.FakeWorker.latest).toBe(worker)

    worker.emit('message', { type: 'closed' })
    await Promise.all([owner, bystander])
    await firstFailed
  })

  it('does not load a worker for a warmup during teardown', async () => {
    const ranker = await load()
    // Pay for the worker so the teardown has something to close.
    await ranker.decide('', [])
    const worker = fake.FakeWorker.latest!
    worker.autoClose = false

    const closing = ranker.disposeRanker()
    await expect(ranker.decide('', [])).resolves.toEqual([])
    expect(fake.FakeWorker.latest).toBe(worker)

    worker.emit('message', { type: 'closed' })
    await closing
  })

  it('ignores a stale ready from a worker it has replaced', async () => {
    const ranker = await load()
    await ranker.decide('', [])
    const stale = fake.FakeWorker.latest!
    stale.autoClose = false

    const closing = ranker.disposeRanker()
    // The real worker posts `ready` before `closed`, so this frame arrives after
    // the dispose reset. Trusting it would leave `ready` true with no worker.
    stale.emit('message', { type: 'ready' })
    stale.emit('message', { type: 'closed' })
    await closing

    const next = ranker.decide('after', ['y'])
    await waitFor(
      () =>
        fake.FakeWorker.latest !== stale && (fake.FakeWorker.latest?.posted.some((m) => m.type === 'decide') ?? false),
    )
    const fresh = fake.FakeWorker.latest!
    fresh.hold = false
    fresh.answer(fresh.posted[fresh.posted.length - 1])
    await expect(next).resolves.toEqual([0.5])
    await ranker.disposeRanker()
  })

  it('fails the in-flight caller when the worker dies, and recovers for the next', async () => {
    const ranker = await load()

    const first = ranker.decide('first', ['x'])
    await waitFor(() => decidePosts().length === 1)
    const second = ranker.decide('second', ['x'])
    await settle()

    fake.FakeWorker.latest!.emit('exit', 1)

    const dead = fake.FakeWorker.latest!
    await expect(first).rejects.toThrow(/exited/)
    // The queued caller is not lost: the next pass starts a fresh worker.
    await waitFor(() => fake.FakeWorker.latest !== dead && fake.FakeWorker.latest!.posted.length >= 1)
    fake.FakeWorker.latest!.hold = false
    fake.FakeWorker.latest!.answer(fake.FakeWorker.latest!.posted[0])
    await expect(second).resolves.toEqual([0.5])
  })
})
