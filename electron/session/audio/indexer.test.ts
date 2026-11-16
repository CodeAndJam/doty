/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createAudioIndexer } from './indexer'
import { AUDIO_EMBEDDING_KEY } from './track'

function store(initial: Record<string, Float32Array> = {}) {
  const vectors = new Map(Object.entries(initial))
  return {
    vectors,
    getVector: (path: string, model: string) => (model === AUDIO_EMBEDDING_KEY ? (vectors.get(path) ?? null) : null),
    putVector: (path: string, model: string, vector: Float32Array) => {
      if (model === AUDIO_EMBEDDING_KEY) vectors.set(path, vector)
    },
  }
}

describe('createAudioIndexer', () => {
  it('classifies every track and keeps the vectors', async () => {
    const s = store()
    const embedded: string[] = []
    const indexer = createAudioIndexer({
      paths: () => ['a.mp3', 'b.mp3'],
      store: s,
      embed: async (path) => {
        embedded.push(path)
        return Float32Array.from(path === 'a.mp3' ? [1, 0] : [0, 1])
      },
      classify: (v) => (v[0] > v[1] ? 'music' : 'sfx'),
    })
    await indexer.run()
    expect(embedded).toEqual(['a.mp3', 'b.mp3'])
    expect(indexer.kinds).toEqual({ 'a.mp3': 'music', 'b.mp3': 'sfx' })
    expect(s.vectors.size).toBe(2)
  })

  it('classifies from the stored vector on a second run', async () => {
    const s = store({ 'a.mp3': Float32Array.from([0, 1]) })
    const indexer = createAudioIndexer({
      paths: () => ['a.mp3'],
      store: s,
      embed: async () => {
        throw new Error('should not decode a stored track')
      },
      classify: () => 'sfx',
    })
    await indexer.run()
    expect(indexer.kinds['a.mp3']).toBe('sfx')
  })

  it('skips a track it cannot decode instead of aborting the pass', async () => {
    const s = store()
    const progress: number[] = []
    const indexer = createAudioIndexer({
      paths: () => ['broken.mp3', 'good.mp3'],
      store: s,
      embed: async (path) => {
        if (path === 'broken.mp3') return null
        return Float32Array.from([1])
      },
      classify: () => 'music',
      onProgress: (p) => progress.push(p.done),
    })
    await indexer.run()
    expect(indexer.kinds).toEqual({ 'good.mp3': 'music' })
    expect(progress).toEqual([1, 2])
  })

  it('treats a thrown decode as a skip, not a failed run', async () => {
    const s = store()
    const indexer = createAudioIndexer({
      paths: () => ['boom.mp3'],
      store: s,
      embed: async () => {
        throw new Error('ffmpeg failed')
      },
      classify: () => 'sfx',
    })
    await expect(indexer.run()).resolves.toBeUndefined()
    expect(indexer.kinds).toEqual({})
    expect(s.vectors.size).toBe(0)
  })
})
