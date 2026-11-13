/**
 * Ranker quality gate — does the model pick the track the DM would have picked?
 *
 *   pnpm ranker:eval                  # needs test-fixtures/ranker/{rows,labels}.json
 *   RANKER_UPDATE_BASELINE=1 pnpm ranker:eval
 *
 * Skips itself when the model, the rows or the labels are absent, so CI stays
 * green on a machine that has never run the app.
 *
 * What the numbers mean:
 *   top1        the model's first choice matched the DM's
 *   top3        it was at least on the first screen of suggestions
 *   precision@.9 of the moments it claimed ≥0.9, how many were right — the only
 *               number that gates autopilot, because it is the risk of an
 *               unasked change being wrong
 *   calibration how often a 0.9 is actually right
 *
 * @vitest-environment node
 */
import fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { D1Omni } from '../d1-omni'

const FIXTURES = join(__dirname, '..', '..', 'test-fixtures', 'ranker')
const ROWS = join(FIXTURES, 'rows.json')
const LABELS = join(FIXTURES, 'labels.json')
const BASELINE = join(FIXTURES, 'baseline.json')
const REPORT = join(__dirname, '..', '..', 'test-results', 'ranker-quality.md')
const MODELS = join(homedir(), '.doty', 'models')

interface Row {
  id: string
  transcript: string
  candidates: Array<{ path: string; description: string }>
}
interface Label {
  id: string
  picked: string | null
  rejects: string[]
}

const ready = fs.existsSync(ROWS) && fs.existsSync(LABELS) && fs.existsSync(join(MODELS, 'd1-omni-text.onnx'))

describe.skipIf(!ready)('ranker quality', () => {
  const rows: Row[] = ready ? JSON.parse(fs.readFileSync(ROWS, 'utf8')) : []
  const labels: Label[] = ready ? JSON.parse(fs.readFileSync(LABELS, 'utf8')) : []
  let model: D1Omni

  beforeAll(async () => {
    model = await D1Omni.load(MODELS, 'd1-omni-text.onnx', ['cpu'])
  }, 300_000)

  async function grade(): Promise<Array<{ picked: string; top1: boolean; top3: boolean; probability: number }>> {
    const byId = new Map(rows.map((r) => [r.id, r]))
    const graded: Array<{ picked: string; top1: boolean; top3: boolean; probability: number }> = []
    for (const label of labels) {
      const row = byId.get(label.id)
      if (!row || !label.picked || label.picked === 'none') continue
      const probabilities = await model.rank(
        row.transcript,
        'Qual destas músicas se adequa melhor ao momento atual da sessão?',
        row.candidates.map((c) => c.description),
      )
      const ranked = row.candidates
        .map((c, i) => ({ path: c.path, p: probabilities[i] ?? 0 }))
        .sort((a, b) => b.p - a.p)
      graded.push({
        picked: label.picked,
        top1: ranked[0]?.path === label.picked,
        top3: ranked.slice(0, 3).some((r) => r.path === label.picked),
        probability: ranked[0]?.p ?? 0,
      })
    }
    return graded
  }

  it('measures the decisions against the DM’s labels', async () => {
    const graded = await grade()
    if (graded.length === 0) {
      console.log('[ranker] no usable labels yet')
      return
    }

    const top1 = graded.filter((g) => g.top1).length / graded.length
    const top3 = graded.filter((g) => g.top3).length / graded.length
    const high = graded.filter((g) => g.probability >= 0.9)
    const precisionAt9 = high.length === 0 ? null : high.filter((g) => g.top1).length / high.length

    const report = [
      '# Ranker quality',
      '',
      `Rows graded: ${graded.length}`,
      '',
      '| metric | value |',
      '| --- | --- |',
      `| top-1 | ${(top1 * 100).toFixed(1)}% |`,
      `| top-3 | ${(top3 * 100).toFixed(1)}% |`,
      `| precision @ ≥0.9 | ${precisionAt9 === null ? 'never reached' : `${(precisionAt9 * 100).toFixed(1)}%`} |`,
      `| rows at ≥0.9 | ${high.length} of ${graded.length} |`,
      '',
    ].join('\n')
    fs.mkdirSync(join(__dirname, '..', '..', 'test-results'), { recursive: true })
    fs.writeFileSync(REPORT, report)
    console.log(report)

    if (process.env.RANKER_UPDATE_BASELINE === '1') {
      fs.writeFileSync(BASELINE, `${JSON.stringify({ top1, top3, precisionAt9 }, null, 2)}\n`)
      return
    }
    if (!fs.existsSync(BASELINE)) return

    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as { top1: number }
    // A regression of more than five points is a change in behaviour, not noise.
    expect(top1).toBeGreaterThan(baseline.top1 - 0.05)
  }, 600_000)
})
