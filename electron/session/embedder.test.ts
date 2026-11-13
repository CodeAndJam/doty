/**
 * The embedder against the real model, when it is installed. Skips otherwise, so
 * CI stays green on a machine that has never downloaded it.
 *
 * @vitest-environment node
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { embedderAvailable, loadEmbedder } from './embedder'
import { cosine } from './embedding'

const DIR = join(homedir(), '.doty', 'models', 'embeddinggemma-300m')

describe.skipIf(!existsSync(DIR) || !embedderAvailable(DIR))('embedder', () => {
  it('puts a calm scene nearer a calm track than a combat track', async () => {
    const model = await loadEmbedder(DIR)
    const scene = await model.embedQuery('Está um momento calmo, o cair da água da masmorra')
    const [calm, combat] = await model.embedDocuments([
      'Exploration Campfire Peace - Campfire 80 BPM energy 0.2',
      'Combat Boss The Enemy 120 BPM energy 1.0',
    ])

    expect(scene).toHaveLength(768)
    expect(cosine(scene, calm)).toBeGreaterThan(cosine(scene, combat))
    // Unit vectors, so these are comparable across runs.
    expect(Math.hypot(...Array.from(scene))).toBeCloseTo(1, 4)
  }, 120_000)
})
