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

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

async function load() {
  fake.FakeWorker.latest = null
  vi.resetModules()
  return import('./ranker')
}

describe('ranker supervisor', () => {
  it('runs one forward pass at a time', async () => {
    const ranker = await load()

    const first = ranker.decide('first', ['x'])
    await tick()
    const second = ranker.decide('second', ['x'])
    await tick()

    const worker = fake.FakeWorker.latest!
    expect(worker.posted.filter((message) => message.type === 'decide')).toHaveLength(1)

    worker.hold = false
    worker.answer(worker.posted[0])
    await expect(first).resolves.toEqual([0.5])
    await tick()

    expect(worker.posted.filter((message) => message.type === 'decide')).toHaveLength(2)
    worker.answer(worker.posted[1])
    await expect(second).resolves.toEqual([0.5])

    await ranker.disposeRanker()
  })

  it('fails a caller that waited for the slot when the worker dies under it', async () => {
    const ranker = await load()

    const first = ranker.decide('first', ['x'])
    await tick()
    const second = ranker.decide('second', ['x'])
    await tick()

    fake.FakeWorker.latest!.emit('exit', 1)

    await expect(first).rejects.toThrow(/exited/)
    // Not the 60 s deadline: the slot was acquired after the worker was gone.
    await expect(second).rejects.toThrow(/not running/)
  })
})
