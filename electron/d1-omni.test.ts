/**
 * @vitest-environment node
 *
 * Replays the export fixture: the token rows Python built must come out identical
 * here, and the graph must answer them the way PyTorch did. Skipped when the
 * exported model is not on this machine.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { type D1Manifest, D1Omni, RANK_INSTRUCTIONS, temperatureFor, toProbabilities } from './d1-omni'

const DIR = process.env.DOTY_MODELS ?? join(homedir(), '.doty', 'models')
const MANIFEST = join(DIR, 'd1-omni-text-manifest.json')
const FIXTURE = join(DIR, 'd1-omni-text-fixture.json')
const ready = existsSync(MANIFEST) && existsSync(FIXTURE) && existsSync(join(DIR, 'd1-omni-text.onnx'))

interface FixtureRow {
  state: string
  options: string[]
  ids: number[]
  markers: number[]
  probabilities: number[]
}

describe.skipIf(!ready)('d1-omni', () => {
  const manifest: D1Manifest = ready ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : ({} as D1Manifest)
  const rows: FixtureRow[] = ready ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : []
  let model: D1Omni

  beforeAll(async () => {
    model = await D1Omni.load(DIR, 'd1-omni-text.onnx', ['cpu'])
  }, 300_000)

  it('builds the same token rows as the reference encoder', () => {
    for (const row of rows) {
      const built = model.build(row.state, RANK_INSTRUCTIONS, row.options)
      expect(built.ids).toEqual(row.ids)
      expect(built.markers).toEqual(row.markers)
    }
  })

  it('answers the fixture rows as PyTorch did', async () => {
    for (const row of rows) {
      const probs = await model.rank(row.state, RANK_INSTRUCTIONS, row.options)
      expect(probs).toHaveLength(row.options.length)
      const worst = Math.max(...probs.map((p, i) => Math.abs(p - row.probabilities[i])))
      expect(worst).toBeLessThan(1e-4)
      expect(probs.indexOf(Math.max(...probs))).toBe(row.probabilities.indexOf(Math.max(...row.probabilities)))
    }
  }, 120_000)

  it('scales logits by the temperature for the option count', () => {
    expect(temperatureFor(manifest.temperatures, 20)).toBeCloseTo(1.372515082359314, 6)
    expect(temperatureFor(manifest.temperatures, 6)).toBeCloseTo(1.1751071214675903, 6)
    expect(toProbabilities([0, 0, 0, 0], 4, 1)).toEqual([0.25, 0.25, 0.25, 0.25])
  })
})
