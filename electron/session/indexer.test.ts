import { describe, expect, it } from 'vitest'
import { createIndexer } from './indexer'

interface Fake {
  embedded: string[]
  stored: Map<string, Float32Array>
}

function harness(paths: string[], opts: { failOn?: string; batch?: number } = {}) {
  const fake: Fake = { embedded: [], stored: new Map() }
  const progress: Array<{ done: number; total: number }> = []
  const indexer = createIndexer({
    paths: () => paths,
    store: {
      getVector: (path, model) => (model === 'test' ? (fake.stored.get(path) ?? null) : null),
      putVector: (path, _model, vector) => {
        fake.stored.set(path, vector)
      },
    },
    embed: async (texts) => {
      for (const t of texts) {
        if (t === opts.failOn) throw new Error('model exploded')
        fake.embedded.push(t)
      }
      return texts.map((_, i) => Float32Array.from([i + 1, 0]))
    },
    model: 'test',
    describe: (path) => path.replace(/\.mp3$/, ''),
    batch: opts.batch ?? 2,
    onProgress: (p) => progress.push({ done: p.done, total: p.total }),
  })
  return { indexer, fake, progress }
}

describe('createIndexer', () => {
  it('embeds every track that has no vector yet', async () => {
    const { indexer, fake } = harness(['a.mp3', 'b.mp3', 'c.mp3'])
    await indexer.run()
    expect(fake.embedded).toEqual(['a', 'b', 'c'])
    expect(fake.stored.size).toBe(3)
  })

  it('skips tracks that already have a vector, so work is resumable', async () => {
    const { indexer, fake } = harness(['a.mp3', 'b.mp3'])
    fake.stored.set('a.mp3', Float32Array.from([1, 0]))
    await indexer.run()
    expect(fake.embedded).toEqual(['b'])
  })

  it('reports progress per batch, not per track', async () => {
    const { indexer, progress } = harness(['a.mp3', 'b.mp3', 'c.mp3'], { batch: 2 })
    await indexer.run()
    // two batches: [a,b] then [c]
    expect(progress.map((p) => p.done)).toEqual([2, 3])
    expect(progress.at(-1)?.total).toBeGreaterThanOrEqual(progress.at(-1)?.done ?? 0)
  })

  it('stops on a failure without losing what it already stored', async () => {
    const { indexer, fake } = harness(['a.mp3', 'b.mp3', 'c.mp3'], { batch: 1, failOn: 'b' })
    await expect(indexer.run()).rejects.toThrow(/exploded/)
    expect(fake.stored.has('a.mp3')).toBe(true)
    expect(fake.stored.has('b.mp3')).toBe(false)
  })

  it('is a no-op when everything is already indexed', async () => {
    const { indexer, fake, progress } = harness(['a.mp3'])
    fake.stored.set('a.mp3', Float32Array.from([1, 0]))
    await indexer.run()
    expect(fake.embedded).toEqual([])
    expect(progress).toEqual([])
  })
})
