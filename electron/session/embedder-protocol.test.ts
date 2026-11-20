import { describe, expect, it, vi } from 'vitest'
import type { Embedder } from './embedder-files'
import { createEmbedderHandler } from './embedder-protocol'

function model(overrides: Partial<Embedder> = {}): Embedder {
  return {
    dim: 768,
    embedDocuments: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array(4))),
    embedQuery: vi.fn(async () => new Float32Array(4)),
    embedAudio: vi.fn(async () => new Float32Array(4)),
    dispose: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('embedder protocol', () => {
  it('reports the capability the model actually has', async () => {
    const withAudio = createEmbedderHandler(async () => model())
    await expect(withAudio.handle({ id: 1, kind: 'load', dir: '/models' })).resolves.toEqual({
      id: 1,
      ok: true,
      value: { dim: 768, audio: true },
    })

    const textOnly = createEmbedderHandler(async () => model({ embedAudio: null }))
    const reply = await textOnly.handle({ id: 1, kind: 'load', dir: '/models' })
    expect(reply).toEqual({ id: 1, ok: true, value: { dim: 768, audio: false } })
  })

  it('dispatches each request kind', async () => {
    const embedder = model()
    const handler = createEmbedderHandler(async () => embedder)
    const pcm = new Float32Array(8)

    await handler.handle({ id: 1, kind: 'documents', dir: '/models', texts: ['a', 'b'] })
    await handler.handle({ id: 2, kind: 'query', dir: '/models', text: 'calm' })
    await handler.handle({ id: 3, kind: 'audio', dir: '/models', pcm })

    expect(embedder.embedDocuments).toHaveBeenCalledWith(['a', 'b'])
    expect(embedder.embedQuery).toHaveBeenCalledWith('calm')
    expect(embedder.embedAudio).toHaveBeenCalledWith(pcm)
  })

  it('answers a failure as a reply, never as a hang', async () => {
    const handler = createEmbedderHandler(async () => model({ embedAudio: null }))
    await expect(handler.handle({ id: 7, kind: 'audio', dir: '/models', pcm: new Float32Array(8) })).resolves.toEqual({
      id: 7,
      ok: false,
      error: 'the audio encoder is not installed',
    })

    const broken = createEmbedderHandler(async () => {
      throw new Error('tokenizer.json is unreadable')
    })
    await expect(broken.handle({ id: 8, kind: 'load', dir: '/models' })).resolves.toEqual({
      id: 8,
      ok: false,
      error: 'tokenizer.json is unreadable',
    })
  })

  it('loads once for two requests that arrive together', async () => {
    const load = vi.fn(async () => model())
    const handler = createEmbedderHandler(load)

    await Promise.all([
      handler.handle({ id: 1, kind: 'query', dir: '/models', text: 'a' }),
      handler.handle({ id: 2, kind: 'query', dir: '/models', text: 'b' }),
    ])

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('disposes the old model when the directory changes, and on dispose', async () => {
    const first = model()
    const second = model()
    const load = vi.fn(async (dir: string) => (dir === '/one' ? first : second))
    const handler = createEmbedderHandler(load)

    await handler.handle({ id: 1, kind: 'load', dir: '/one' })
    await handler.handle({ id: 2, kind: 'load', dir: '/two' })
    expect(first.dispose).toHaveBeenCalledTimes(1)

    await handler.handle({ id: 3, kind: 'dispose' })
    expect(second.dispose).toHaveBeenCalledTimes(1)
    // The cache ended: the next load asks for the model again.
    await handler.handle({ id: 4, kind: 'load', dir: '/two' })
    expect(load).toHaveBeenLastCalledWith('/two')
    expect(load).toHaveBeenCalledTimes(3)
  })
})
