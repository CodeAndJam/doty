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
import { grade } from './grade'

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
  /** False when the DM picked a library track that was not among the twenty. */
  offered?: boolean
}

const ready = fs.existsSync(ROWS) && fs.existsSync(LABELS) && fs.existsSync(join(MODELS, 'd1-omni-text.onnx'))

describe.skipIf(!ready)('ranker quality', () => {
  const rows: Row[] = ready ? JSON.parse(fs.readFileSync(ROWS, 'utf8')) : []
  const labels: Label[] = ready ? JSON.parse(fs.readFileSync(LABELS, 'utf8')) : []
  let model: D1Omni

  beforeAll(async () => {
    model = await D1Omni.load(MODELS, 'd1-omni-text.onnx', ['cpu'])
  }, 300_000)

  /** One model pass per labelled row; the grading itself is pure and tested. */
  async function probabilities(): Promise<Map<string, number[]>> {
    const byId = new Map(rows.map((r) => [r.id, r]))
    const out = new Map<string, number[]>()
    for (const label of labels) {
      const row = byId.get(label.id)
      if (!row || label.picked === null) continue
      out.set(
        label.id,
        await model.rank(
          row.transcript,
          'Qual destas músicas se adequa melhor ao momento atual da sessão?',
          row.candidates.map((c) => c.description),
        ),
      )
    }
    return out
  }

  it('grades ranking and retrieval separately', async () => {
    if (labels.every((l) => l.picked === null)) {
      console.log('[ranker] no usable labels yet')
      return
    }

    const result = grade({ rows, labels, probabilities: await probabilities() })
    const pct = (v: number) => `${(v * 100).toFixed(1)}%`

    const report = [
      '# Ranker quality',
      '',
      `Labelled rows: ${labels.filter((l) => l.picked !== null).length}`,
      '',
      '## Ranking — given the twenty, did it choose well?',
      '',
      '| metric | value |',
      '| --- | --- |',
      `| rows | ${result.ranking.n} |`,
      `| top-1 | ${pct(result.ranking.top1)} |`,
      `| top-3 | ${pct(result.ranking.top3)} |`,
      `| precision @ ≥0.9 | ${result.ranking.precisionAt9 === null ? 'never reached' : pct(result.ranking.precisionAt9)} |`,
      `| rows at ≥0.9 | ${result.ranking.at9} of ${result.ranking.n} |`,
      '',
      '## Retrieval — were the twenty the right ones?',
      '',
      '| metric | value |',
      '| --- | --- |',
      `| picks made | ${result.retrieval.n} |`,
      `| offered by the prefilter | ${pct(result.retrieval.share)} |`,
      `| recall misses | ${result.retrieval.misses} |`,
      '',
      result.retrieval.misses === 0
        ? 'No recall misses: every pick was among the twenty.'
        : `Never offered:\n${result.retrieval.missTracks.map((t) => `- ${t}`).join('\n')}`,
      '',
      '## Abstention — "nothing here fits"',
      '',
      `Rows: ${result.abstention.n} · mean top probability: ${result.abstention.meanTop.toFixed(3)}`,
      '',
      'A high mean here is the dangerous case: the model wanted to act on a',
      'scene where nothing in the library suited.',
      '',
      '## Per example',
      '',
      '| example | your pick ranked | model top pick | p |',
      '| --- | --- | --- | --- |',
      ...result.details.map(
        (d) =>
          `| ${d.id} | ${d.pickedRank === 0 ? 'not found' : `${d.pickedRank} of 20`} | ${d.topPath?.split('/').pop() ?? '—'} | ${(d.topProbability * 100).toFixed(0)}% |`,
      ),
      '',
    ].join('\n')

    fs.mkdirSync(join(__dirname, '..', '..', 'test-results'), { recursive: true })
    fs.writeFileSync(REPORT, report)
    console.log(report)

    if (process.env.RANKER_UPDATE_BASELINE === '1') {
      fs.writeFileSync(
        BASELINE,
        `${JSON.stringify({ top1: result.ranking.top1, top3: result.ranking.top3, recall: result.retrieval.share }, null, 2)}\n`,
      )
      return
    }
    if (!fs.existsSync(BASELINE)) return

    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as { top1: number; recall: number }
    // A regression of more than five points is a change in behaviour, not noise.
    expect(result.ranking.top1).toBeGreaterThan(baseline.top1 - 0.05)
    expect(result.retrieval.share).toBeGreaterThan(baseline.recall - 0.05)
  }, 600_000)
})
