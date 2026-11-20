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

    constructor() {
      FakeWorker.latest = this
      // After the handlers are attached, as a real worker's `ready` would be.
      setTimeout(() => this.emit('message', { type: 'ready' }), 0)
    }

    on(event: string, listener: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    }

    once(event: string, listener: Listener) {
      this.on(event, listener)
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
        setTimeout(() => this.emit('message', { type: 'closed' }), 0)
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

    terminate() {}
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

  it('does not merge a reordered option list', async () => {
    const ranker = await load()

    const first = ranker.decide('first', ['x', 'y'])
    await waitFor(() => decidePosts().length === 1)
    const second = ranker.decide('second', ['y', 'x'])
    // Same files, different order: a sorted-key merge would fold this into
    // `second`, and the probabilities would map to the wrong tracks.
    const third = ranker.decide('third', ['x', 'y'])
    await settle()
    expect(decidePosts()).toHaveLength(1)

    const worker = fake.FakeWorker.latest!
    worker.hold = false
    worker.answer(worker.posted[0])
    await expect(first).resolves.toEqual([0.5])
    await waitFor(() => decidePosts().length === 2)
    worker.answer(worker.posted[1])
    await waitFor(() => decidePosts().length === 3)
    worker.answer(worker.posted[2])
    await expect(second).resolves.toEqual([0.5])
    await expect(third).resolves.toEqual([0.5])
    expect(decidePosts()).toHaveLength(3)

    await ranker.disposeRanker()
  })

  it('serves another question kind before the next queued decide', async () => {
    const ranker = await load()

    const first = ranker.decide('first', ['x'])
    await waitFor(() => decidePosts().length === 1)
    // A backlog of two decides, then one effects question. The first decide job
    // is taken; the second must go behind `sfx`, not in front of it.
    const second = ranker.decide('second', ['y'])
    const third = ranker.decide('third', ['w'])
    const sfx = ranker.rankSfx('a roar', ['z'])
    await settle()

    const worker = fake.FakeWorker.latest!
    worker.hold = false
    worker.answer(worker.posted[0])
    await expect(first).resolves.toEqual([0.5])

    // `second` was queued first; the rotation only reorders what is left.
    await waitFor(() => worker.posted.length === 2)
    expect((worker.posted[1] as { prompt?: string }).prompt).toBe('second')
    worker.answer(worker.posted[1])
    await expect(second).resolves.toEqual([0.5])

    // Round-robin: the decide backlog must not starve the effects question.
    await waitFor(() => worker.posted.length === 3)
    expect((worker.posted[2] as { type: string }).type).toBe('sfx')
    worker.answer(worker.posted[2])
    await expect(sfx).resolves.toEqual([0.5])

    await waitFor(() => worker.posted.length === 4)
    worker.answer(worker.posted[3])
    await expect(third).resolves.toEqual([0.5])

    await ranker.disposeRanker()
  })

  it('does not merge a question whose options changed', async () => {
    const ranker = await load()

    const first = ranker.decide('first', ['x'])
    await waitFor(() => decidePosts().length === 1)
    const second = ranker.decide('second', ['y'])
    const third = ranker.decide('third', ['z'])
    await settle()
    expect(decidePosts()).toHaveLength(1)

    const worker = fake.FakeWorker.latest!
    worker.hold = false
    worker.answer(worker.posted[0])
    await expect(first).resolves.toEqual([0.5])
    await waitFor(() => decidePosts().length === 2)
    worker.answer(worker.posted[1])
    await waitFor(() => decidePosts().length === 3)
    worker.answer(worker.posted[2])

    await expect(second).resolves.toEqual([0.5])
    await expect(third).resolves.toEqual([0.5])
    expect(decidePosts()).toHaveLength(3)

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
