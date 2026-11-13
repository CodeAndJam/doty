/**
 * Headless evaluation run: asks the model what it would play for every harvested
 * example, and writes what it decided so a human can judge it.
 *
 *   pnpm ranker:headless
 *
 * Writes:
 *   test-results/ranker-headless.md    — readable, one block per example
 *   test-results/ranker-headless.json  — machine-readable
 *   test-fixtures/ranker/rows.json     — rows gain a `model` block for the lab
 *
 * @vitest-environment node
 */
import fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { D1Omni, MOODS } from '../d1-omni'
import { DEFAULT_POLICY, decideAction } from './policy'

const FIXTURES = join(__dirname, '..', '..', 'test-fixtures', 'ranker')
const ROWS = join(FIXTURES, 'rows.json')
const RESULTS = join(__dirname, '..', '..', 'test-results')
const MODELS = join(homedir(), '.doty', 'models')

interface Row {
  id: string
  transcript: string
  candidates: Array<{ path: string; description: string }>
  model?: unknown
}

const ready = fs.existsSync(ROWS) && fs.existsSync(join(MODELS, 'd1-omni-text.onnx'))

describe.skipIf(!ready)('headless ranker run', () => {
  const rows: Row[] = ready ? JSON.parse(fs.readFileSync(ROWS, 'utf8')) : []
  let model: D1Omni

  beforeAll(async () => {
    model = await D1Omni.load(MODELS, 'd1-omni-text.onnx', ['cpu'])
  }, 300_000)

  it('decides for every example and records what it chose', async () => {
    const limit = Number.parseInt(process.env.RANKER_HEADLESS_LIMIT ?? '0', 10)
    const sample = limit > 0 ? rows.slice(0, limit) : rows
    const results: Array<Record<string, unknown>> = []
    const blocks: string[] = ['# Headless ranker run', '']

    for (const row of sample) {
      const { tracks, moods } = await model.evaluate(
        row.transcript,
        row.candidates.map((c) => c.description),
      )
      const ranked = row.candidates
        .map((c, i) => ({ path: c.path, description: c.description, probability: tracks[i] ?? 0 }))
        .sort((a, b) => b.probability - a.probability)
      const top = ranked[0]?.probability ?? 0

      let moodIndex = 0
      for (let i = 1; i < moods.length; i++) if (moods[i] > moods[moodIndex]) moodIndex = i
      const mood = MOODS[moodIndex] ?? 'unknown'

      // What the policy would do at a boundary, and mid-track, for this top pick.
      const base = {
        probability: top,
        sameScene: false,
        categorical: false,
        msSinceLastChange: 600_000,
        autopilot: true,
        override: false,
      }
      const atBoundary = decideAction({ ...base, msUntilTrackEnd: 15_000 }, DEFAULT_POLICY)
      const midTrack = decideAction({ ...base, msUntilTrackEnd: 200_000 }, DEFAULT_POLICY)
      const categorical = decideAction({ ...base, categorical: true, msUntilTrackEnd: 200_000 }, DEFAULT_POLICY)

      row.model = {
        mood,
        topProbability: top,
        ranked: ranked.slice(0, 5).map(({ path, probability }) => ({ path, probability })),
      }
      results.push({
        id: row.id,
        transcript: row.transcript,
        mood,
        topProbability: top,
        actionAtBoundary: atBoundary.kind,
        actionMidTrack: midTrack.kind,
        actionCategorical: categorical.kind,
        ranked: ranked.slice(0, 5),
      })

      blocks.push(
        `## ${row.id} · ${mood} · ${(top * 100).toFixed(0)}%`,
        '',
        `> ${row.transcript}`,
        '',
        `boundary: **${atBoundary.kind}** · mid-track: **${midTrack.kind}** · categorical: **${categorical.kind}**`,
        '',
        '| # | track | p |',
        '| --- | --- | --- |',
        ...ranked.slice(0, 5).map((r, i) => `| ${i + 1} | ${r.description} | ${(r.probability * 100).toFixed(1)}% |`),
        '',
      )
    }

    fs.mkdirSync(RESULTS, { recursive: true })
    fs.writeFileSync(join(RESULTS, 'ranker-headless.json'), `${JSON.stringify(results, null, 1)}\n`)
    fs.writeFileSync(join(RESULTS, 'ranker-headless.md'), `${blocks.join('\n')}\n`)
    fs.writeFileSync(ROWS, `${JSON.stringify(rows, null, 1)}\n`)

    console.log(`[headless] ${results.length} examples decided, see test-results/ranker-headless.md`)
    expect(results).toHaveLength(sample.length)
  }, 900_000)
})
