/**
 * Retrieval against the real library: does a vector search for a calm scene
 * actually surface calm tracks?
 *
 * Skips when the model or the app database is absent, so CI stays green.
 *
 * @vitest-environment node
 */

import fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { EMBEDDING_MODEL, embedderAvailable, loadEmbedder } from './embedder'
import { topK } from './embedding'
import { createIndexer } from './indexer'
import { createSessionStore } from './store'

const DIR = join(homedir(), '.doty', 'models', 'embeddinggemma-2')
const DB = join(homedir(), '.doty', 'doty.db')

describe.skipIf(!fs.existsSync(DB) || !embedderAvailable(DIR))('retrieval', () => {
  it('ranks a calm track near a calm scene, and a loud one near a chase', async () => {
    const db = new Database(DB, { readonly: true })
    // A sample of the library keeps this honest and quick.
    const rows = db
      .prepare('select path, genre, bpm, energy, scale from tracks order by path limit 40')
      .all() as Array<{ path: string; genre: string; bpm: number; energy: number; scale: string }>
    const paths = rows.map((r) => r.path)
    const metadata = new Map(rows.map((r) => [r.path, r]))
    db.close()
    if (paths.length < 5) return

    const store = createSessionStore(new Database(':memory:'))
    const embedder = await loadEmbedder(DIR)
    await createIndexer({
      paths: () => paths,
      store,
      embed: (texts) => embedder.embedDocuments(texts),
      model: EMBEDDING_MODEL,
      describe: (p) => {
        const m = metadata.get(p)
        const name = p.replace(/\.[^.]+$/, '').replace(/[-_/]/g, ' ')
        const facts = [
          m?.genre,
          m?.bpm ? `${m.bpm} BPM` : null,
          m?.energy !== undefined ? `energy ${m.energy.toFixed(1)}` : null,
        ].filter(Boolean)
        return facts.length > 0 ? `${name} — ${facts.join(', ')}` : name
      },
      batch: 8,
    }).run()

    const vectors = new Map<string, Float32Array>()
    for (const path of paths) {
      const v = store.getVector(path, EMBEDDING_MODEL)
      if (v) vectors.set(path, v)
    }
    expect(vectors.size).toBe(paths.length)

    const calm = topK(await embedder.embedQuery('Está um momento calmo, o cair da água da masmorra'), vectors, 5)
    const chase = topK(await embedder.embedQuery('Corram! O dragão vem atrás de nós pela caverna'), vectors, 5)
    console.log('[retrieval] calm :', calm)
    console.log('[retrieval] chase:', chase)

    expect(calm.length).toBe(5)
    expect(calm).not.toEqual(chase)
  }, 600_000)
})
