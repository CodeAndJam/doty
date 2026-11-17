import { describe, expect, it } from 'vitest'
import { createLibrary, type LibraryDeps } from './library'
import type { Embedder } from './session/embedder'
import { RETRIEVAL_KEY } from './session/embedder'
import type { SfxItem } from './sfx-library'

/** Vectors that keep the arithmetic obvious: a match is the same direction. */
function vector(...values: number[]): Float32Array {
  return Float32Array.from(values)
}

function fakeEmbedder(): Embedder {
  const table: Record<string, Float32Array> = {
    tavern: vector(1, 0),
    'a tavern with a warm fireplace': vector(1, 0),
    'combat drums': vector(0, 1),
  }
  return {
    dim: 2,
    embedDocuments: async (texts) => texts.map((text) => table[text.toLowerCase()] ?? vector(0, 0)),
    embedQuery: async (text) => table[text.toLowerCase()] ?? vector(0, 0),
    embedAudio: null,
  }
}

function harness(overrides: Partial<LibraryDeps> = {}) {
  const vectors = new Map<string, Float32Array>()
  const sfxItems: SfxItem[] = [
    {
      id: 'Door/door slam.wav',
      filename: '/sfx/Door/door slam.wav',
      category: 'Door',
      label: 'door slam',
      description: '',
      duration: 0,
      source: 'custom',
    },
  ]
  const written: string[] = []
  const deps: LibraryDeps = {
    folders: () => ({ music: '/music', sfx: '/sfx' }),
    musicFiles: () => ['Tavern/tavern.mp3', 'Combat/drums.mp3'],
    sfxItems: () => sfxItems,
    facts: () => ({
      'Tavern/tavern.mp3': { duration: 200, genre: 'Music' } as never,
      'Combat/drums.mp3': { duration: 200, genre: 'Music' } as never,
    }),
    tags: () => ({}),
    overrides: () => ({}),
    setOverride: (key, lane) => written.push(`${key}:${lane}`),
    clearOverride: (key) => written.push(`${key}:clear`),
    embedder: async () => fakeEmbedder(),
    embedderAvailable: () => true,
    audioAvailable: () => false,
    kindAnchors: async () => null,
    embedAudio: async () => null,
    store: {
      getVector: (key, model) => vectors.get(`${key}|${model}`) ?? null,
      putVector: (key, model, v) => vectors.set(`${key}|${model}`, v),
    },
    onStatus: () => {},
    ...overrides,
  }
  return { library: createLibrary(deps), vectors, written }
}

describe('library', () => {
  it('lists both folders once, with the lane each file resolves to', () => {
    const { library } = harness()
    const items = library.items()
    expect(items.map((item) => item.key)).toEqual(['Tavern/tavern.mp3', 'Combat/drums.mp3', 'sfx:Door/door slam.wav'])
    expect(items[2].lane).toBe('sfx')
  })

  it('keeps an effect on the effects shelf on the folder alone', () => {
    // The category folder is the DM's taxonomy, not a music cue: "Ambience" here
    // names a shelf of effects, and the name-only classifier used to outvote it.
    const { library } = harness({
      sfxItems: () => [
        {
          id: 'Ambience/rain loop.wav',
          filename: '/sfx/Ambience/rain loop.wav',
          category: 'Ambience',
          label: 'rain loop',
          description: '',
          duration: 0,
          source: 'custom',
        },
      ],
      folders: () => ({ music: '/music', sfx: '/sfx' }),
    })
    const item = library.items().find((i) => i.origin === 'sfx')
    expect(item?.lane).toBe('sfx')
  })

  it('uses a measured effect duration the way it uses a cue duration', () => {
    // Once the probe has run, seconds decide: a long bed in the effects folder is
    // a cue, and a short stab is an effect wherever it lives.
    const { library } = harness({
      sfxItems: () => [
        {
          id: 'Weather/storm.wav',
          filename: '/sfx/Weather/storm.wav',
          category: 'Weather',
          label: 'storm',
          description: '',
          duration: 240,
          source: 'custom',
        },
      ],
    })
    const item = library.items().find((i) => i.key === 'sfx:Weather/storm.wav')
    expect(item?.lane).toBe('music')
  })

  it('reports where each item came from as well as what it is filed as', () => {
    const { library } = harness({ overrides: () => ({ 'sfx:Door/door slam.wav': 'music' }) })
    const item = library.items().find((i) => i.key === 'sfx:Door/door slam.wav')
    expect(item).toMatchObject({ origin: 'sfx', lane: 'music', laneSource: 'override' })
  })

  it('does not list a one-folder library twice', () => {
    const { library } = harness({ folders: () => ({ music: '/music', sfx: '/music' }) })
    expect(library.items()).toHaveLength(2)
  })

  it('answers by text until every track on the lane is embedded', async () => {
    const { library } = harness()
    const result = await library.search('tavern', 'music', 5)
    expect(result.mode).toBe('text')
    expect(result.items.map((item) => item.key)).toEqual(['Tavern/tavern.mp3'])
  })

  it('answers semantically once the lane is fully embedded', async () => {
    const { library, vectors } = harness()
    vectors.set(`Tavern/tavern.mp3|${RETRIEVAL_KEY}`, vector(1, 0))
    vectors.set(`Combat/drums.mp3|${RETRIEVAL_KEY}`, vector(0, 1))
    const result = await library.search('tavern', 'music', 2)
    expect(result.mode).toBe('semantic')
    expect(result.items[0].key).toBe('Tavern/tavern.mp3')
  })

  it('indexes the library and reports a phase per pass', async () => {
    const phases: string[] = []
    const { library, vectors } = harness({
      // The indexer asks for the description text, so the fake embedder can match.
      facts: () => ({}),
      onStatus: (status) => phases.push(status.phase),
    })
    await library.ensureIndexed()
    expect(vectors.size).toBe(3)
    expect(phases).toContain('text')
    expect(library.status()).toMatchObject({ phase: 'idle', indexed: 3, total: 3 })
  })

  it('exposes the resolved lane for every item, both folders', () => {
    const { library } = harness({ overrides: () => ({ 'sfx:Door/door slam.wav': 'music' }) })
    const byKey = new Map(library.items().map((item) => [item.key, item.lane]))
    expect(byKey.get('Tavern/tavern.mp3')).toBe('music')
    expect(byKey.get('sfx:Door/door slam.wav')).toBe('music')
  })

  it('survives a store that is already closed', () => {
    // Quitting closes the database while a window event may still ask for
    // status. That must report nothing embedded, not take the process down.
    const { library } = harness({
      store: {
        getVector: () => {
          throw new Error('The database connection is not open')
        },
        putVector: () => {},
      },
    })
    expect(() => library.pause()).not.toThrow()
    expect(library.status()).toMatchObject({ indexed: 0, total: 0, paused: true })
  })

  it('writes a lane label without touching the disk', () => {
    const { library, written } = harness()
    library.setLane('sfx:Door/door slam.wav', 'music')
    expect(written).toEqual(['sfx:Door/door slam.wav:music'])
  })

  it('holds the index while paused and finishes after resume', async () => {
    const { library, vectors } = harness()
    library.pause()
    let settled = false
    const run = library.ensureIndexed().then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(settled).toBe(false)
    expect(library.status().paused).toBe(true)
    library.resume()
    await run
    expect(vectors.size).toBe(3)
  })
})
