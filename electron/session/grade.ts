/**
 * Grading the ranker separates two questions that a single accuracy number
 * hides:
 *
 *   ranking   — given the twenty it was offered, did it choose well?
 *   retrieval — were the twenty the right ones, or was the right track in the
 *               library and never offered?
 *
 * A recall miss is not the model's fault, and counting it as a wrong answer
 * would send you tuning a model that was never shown the answer. Likewise
 * "nothing here fits" is a label, not a miss: the model should be unsure there.
 */

export interface GradeRow {
  id: string
  candidates: Array<{ path: string }>
}

export interface GradeLabel {
  id: string
  /** A candidate path, the literal 'none', or null when unlabelled. */
  picked: string | null
  /** False when the pick came from the library and was not among the twenty. */
  offered?: boolean
}

export interface Grade {
  ranking: {
    /** Rows where the pick was among the candidates. */
    n: number
    top1: number
    top3: number
    /** Of the rows where the model claimed ≥0.9, how many it got right. */
    precisionAt9: number | null
    at9: number
  }
  retrieval: {
    /** Labelled rows that named a track at all (excluding 'none'). */
    n: number
    /** Picks that were not among the twenty offered. */
    misses: number
    /** Share of picks the prefilter managed to offer. */
    share: number
    missTracks: string[]
  }
  abstention: {
    /** Rows labelled "nothing here fits". */
    n: number
    /** Mean top probability there: high means the model wanted to act anyway. */
    meanTop: number
  }
}

export interface GradeInput {
  rows: GradeRow[]
  labels: GradeLabel[]
  /** id → probability per candidate, in candidate order. */
  probabilities: Map<string, number[]>
}

const TOP3 = 3
const CONFIDENT = 0.9

type Outcome =
  | { kind: 'skip' }
  | { kind: 'abstain'; top: number }
  | { kind: 'miss'; path: string }
  | { kind: 'rank'; position: number; top: number }

function classify(label: GradeLabel, row: GradeRow | undefined, probabilities: number[]): Outcome {
  if (!row || label.picked === null) return { kind: 'skip' }
  if (label.picked === 'none')
    return { kind: 'abstain', top: probabilities.length > 0 ? Math.max(...probabilities) : 0 }

  const offered = label.offered !== false && row.candidates.some((candidate) => candidate.path === label.picked)
  if (!offered) return { kind: 'miss', path: label.picked }

  const ranked = probabilities.map((p, i) => ({ path: row.candidates[i]?.path, p })).sort((a, b) => b.p - a.p)
  return {
    kind: 'rank',
    position: ranked.findIndex((entry) => entry.path === label.picked),
    top: ranked[0]?.p ?? 0,
  }
}

function addRanking(
  acc: { n: number; top1: number; top3: number; at9: number; correctAt9: number },
  o: { position: number; top: number },
): void {
  acc.n += 1
  if (o.position === 0) acc.top1 += 1
  if (o.position >= 0 && o.position < TOP3) acc.top3 += 1
  if (o.top >= CONFIDENT) {
    acc.at9 += 1
    if (o.position === 0) acc.correctAt9 += 1
  }
}

export function grade({ rows, labels, probabilities }: GradeInput): Grade {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const ranking = { n: 0, top1: 0, top3: 0, at9: 0, correctAt9: 0 }
  const retrieval = { n: 0, misses: 0, missTracks: [] as string[] }
  const abstention = { n: 0, total: 0 }

  for (const label of labels) {
    const outcome = classify(label, byId.get(label.id), probabilities.get(label.id) ?? [])

    if (outcome.kind === 'skip') continue
    if (outcome.kind === 'abstain') {
      abstention.n += 1
      abstention.total += outcome.top
      continue
    }

    retrieval.n += 1
    if (outcome.kind === 'miss') {
      retrieval.misses += 1
      retrieval.missTracks.push(outcome.path)
      continue
    }
    addRanking(ranking, outcome)
  }

  return {
    ranking: {
      n: ranking.n,
      top1: ranking.n === 0 ? 0 : ranking.top1 / ranking.n,
      top3: ranking.n === 0 ? 0 : ranking.top3 / ranking.n,
      at9: ranking.at9,
      precisionAt9: ranking.at9 === 0 ? null : ranking.correctAt9 / ranking.at9,
    },
    retrieval: {
      n: retrieval.n,
      misses: retrieval.misses,
      share: retrieval.n === 0 ? 0 : (retrieval.n - retrieval.misses) / retrieval.n,
      missTracks: retrieval.missTracks,
    },
    abstention: {
      n: abstention.n,
      meanTop: abstention.n === 0 ? 0 : abstention.total / abstention.n,
    },
  }
}
