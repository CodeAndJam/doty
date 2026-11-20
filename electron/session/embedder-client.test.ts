import { beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The client's job is the process boundary, so the boundary is faked: a child
 * that records what it was sent, answers when told to, and can exit. Electron's
 * `utilityProcess` is the only thing replaced.
 */
const fake = vi.hoisted(() => {
  type Listener = (value: unknown) => void

  class Child {
    static latest: Child | null = null
    private listeners = new Map<string, Listener[]>()
    posted: Array<Record<string, unknown>> = []
    killed = false
    /** Answers every request immediately unless a test holds it. */
    auto = true
    capability = { dim: 768, audio: true }

    constructor() {
      Child.latest = this
    }

    on(event: string, listener: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    }

    emit(event: string, value?: unknown) {
      for (const listener of this.listeners.get(event) ?? []) listener(value)
    }

    postMessage(message: Record<string, unknown>) {
      this.posted.push(message)
      if (!this.auto) return
      queueMicrotask(() => {
        if (message.kind === 'load') {
          this.emit('message', { id: message.id, ok: true, value: this.capability })
        } else if (message.kind === 'documents') {
          this.emit('message', { id: message.id, ok: true, value: [(message as { texts: string[] }).texts.length] })
        } else if (message.kind === 'query') {
          this.emit('message', { id: message.id, ok: true, value: [0.5] })
        } else {
          this.emit('message', { id: message.id, ok: true })
        }
      })
    }

    kill() {
      this.killed = true
      this.emit('exit', 0)
    }
  }

  /** The child the next `fork` should hand back, so a test can drive it. */
  const state: { next: Child | null } = { next: null }

  return { Child, state }
})

vi.mock('electron', () => ({
  utilityProcess: {
    fork: () => {
      const child = fake.state.next ?? new fake.Child()
      fake.state.next = null
      return child
    },
  },
}))

/** Hand the next fork a child the test can drive. */
function nextChild(): InstanceType<typeof fake.Child> {
  const child = new fake.Child()
  fake.state.next = child
  return child
}

let createEmbedder: typeof import('./embedder-client').createEmbedder

beforeAll(async () => {
  createEmbedder = (await import('./embedder-client')).createEmbedder
})

describe('embedder client', () => {
  it('takes its capability from the worker that loaded the model', async () => {
    const child = nextChild()
    child.capability = { dim: 384, audio: false }

    const embedder = await createEmbedder('/models')
    expect(embedder.dim).toBe(384)
    expect(embedder.embedAudio).toBeNull()
    await embedder.dispose()
  })

  it('kills a child whose handshake fails instead of leaking it', async () => {
    const child = nextChild()
    child.auto = false
    const forked = createEmbedder('/models')
    queueMicrotask(() => {
      const load = child.posted.find((message) => message.kind === 'load')!
      child.emit('message', { id: load.id, ok: false, error: 'tokenizer.json is unreadable' })
    })

    await expect(forked).rejects.toThrow('tokenizer.json is unreadable')
    expect(child.killed).toBe(true)
  })

  it('rejects in-flight work and drops the handle when the process exits', async () => {
    const child = nextChild()
    const onExit = vi.fn()
    const embedder = await createEmbedder('/models', { onExit })

    child.auto = false
    const pending = embedder.embedQuery('calm')
    child.auto = false
    child.emit('exit', 1)

    await expect(pending).rejects.toThrow('exited')
    expect(onExit).toHaveBeenCalledWith(embedder)
    await expect(embedder.embedQuery('again')).rejects.toThrow('exited')
  })

  it('disposes the model before killing the process', async () => {
    const child = nextChild()
    const embedder = await createEmbedder('/models')
    await embedder.dispose()

    expect(child.posted.some((message) => message.kind === 'dispose')).toBe(true)
    expect(child.killed).toBe(true)
  })
})
