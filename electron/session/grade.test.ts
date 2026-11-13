import { describe, expect, it } from 'vitest'
import { type GradeInput, grade } from './grade'

const rows = [
  { id: 'a', candidates: [{ path: 'a1.mp3' }, { path: 'a2.mp3' }, { path: 'a3.mp3' }, { path: 'a4.mp3' }] },
  { id: 'b', candidates: [{ path: 'b1.mp3' }, { path: 'b2.mp3' }] },
  { id: 'c', candidates: [{ path: 'c1.mp3' }, { path: 'c2.mp3' }] },
  { id: 'd', candidates: [{ path: 'd1.mp3' }, { path: 'd2.mp3' }] },
]

const input = (labels: GradeInput['labels'], probabilities: GradeInput['probabilities']): GradeInput => ({
  rows,
  labels,
  probabilities,
})

describe('grade', () => {
  it('credits a top-1 pick and a top-3 pick separately', () => {
    const g = grade(
      input(
        [
          { id: 'a', picked: 'a1.mp3' },
          { id: 'b', picked: 'b2.mp3' },
        ],
        new Map([
          ['a', [0.7, 0.1, 0.1, 0.1]],
          ['b', [0.5, 0.45]],
        ]),
      ),
    )
    expect(g.ranking.n).toBe(2)
    expect(g.ranking.top1).toBe(0.5)
    expect(g.ranking.top3).toBe(1)
  })

  it('does not blame the model for a track it was never offered', () => {
    // The DM picked a library track outside the twenty: a recall miss.
    const g = grade(input([{ id: 'a', picked: 'NotOffered.mp3', offered: false }], new Map([['a', [0.9, 0, 0, 0]]])))
    expect(g.ranking.n).toBe(0)
    expect(g.retrieval.n).toBe(1)
    expect(g.retrieval.misses).toBe(1)
    expect(g.retrieval.share).toBe(0)
    expect(g.retrieval.missTracks).toEqual(['NotOffered.mp3'])
  })

  it('treats "nothing here fits" as abstention, not as a miss', () => {
    const g = grade(input([{ id: 'a', picked: 'none' }], new Map([['a', [0.4, 0.3, 0.2, 0.1]]])))
    expect(g.ranking.n).toBe(0)
    expect(g.retrieval.n).toBe(0)
    expect(g.abstention.n).toBe(1)
    expect(g.abstention.meanTop).toBeCloseTo(0.4, 6)
  })

  it('reports precision at the autopilot threshold, the risk of acting', () => {
    // Two confident rows, one wrong: acting unasked would be wrong half the time.
    const g = grade(
      input(
        [
          { id: 'a', picked: 'a1.mp3' },
          { id: 'b', picked: 'b2.mp3' },
          { id: 'c', picked: 'c1.mp3' },
        ],
        new Map([
          ['a', [0.95, 0.05]],
          ['b', [0.93, 0.07]],
          ['c', [0.6, 0.4]],
        ]),
      ),
    )
    expect(g.ranking.at9).toBe(2)
    expect(g.ranking.precisionAt9).toBe(0.5)
  })

  it('ignores unlabelled rows', () => {
    const g = grade(input([{ id: 'a', picked: null }], new Map([['a', [0.9, 0.1]]])))
    expect(g.ranking.n).toBe(0)
    expect(g.retrieval.n).toBe(0)
    expect(g.abstention.n).toBe(0)
  })

  it('is empty rather than NaN when nothing is labelled', () => {
    const g = grade(input([], new Map()))
    expect(g.ranking.top1).toBe(0)
    expect(g.retrieval.share).toBe(0)
    expect(g.ranking.precisionAt9).toBeNull()
  })
})
