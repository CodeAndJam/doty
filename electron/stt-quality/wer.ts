/**
 * Word/character error rate for the STT quality gate.
 * Pure functions — no Electron, no model — so CI can test them everywhere.
 */

/** Portuguese text keeps its accents: "está" and "esta" are different words. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

function levenshtein<T>(ref: T[], hyp: T[]): { distance: number; sub: number; del: number; ins: number } {
  const rows = ref.length + 1
  const cols = hyp.length + 1
  // Only two rows are needed for the distance; the traceback counts come from
  // the same recurrence, kept in a full matrix for clarity (inputs are short).
  const d: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0))
  for (let i = 0; i < rows; i++) d[i][0] = i
  for (let j = 0; j < cols; j++) d[0][j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    }
  }
  let sub = 0
  let del = 0
  let ins = 0
  let i = ref.length
  let j = hyp.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      if (ref[i - 1] !== hyp[j - 1]) sub++
      i--
      j--
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      del++
      i--
    } else {
      ins++
      j--
    }
  }
  return { distance: d[ref.length][hyp.length], sub, del, ins }
}

export interface ErrorRate {
  /** 0..1 — multiply by 100 for a percentage. */
  rate: number
  refUnits: number
  hypUnits: number
  substitutions: number
  deletions: number
  insertions: number
}

export function wordErrorRate(ref: string, hyp: string): ErrorRate {
  const r = tokenize(ref)
  const h = tokenize(hyp)
  // Empty reference: any output is an insertion. A silence fixture must transcribe to nothing.
  if (r.length === 0) {
    return {
      rate: h.length === 0 ? 0 : 1,
      refUnits: 0,
      hypUnits: h.length,
      substitutions: 0,
      deletions: 0,
      insertions: h.length,
    }
  }
  const { distance, sub, del, ins } = levenshtein(r, h)
  return {
    rate: distance / r.length,
    refUnits: r.length,
    hypUnits: h.length,
    substitutions: sub,
    deletions: del,
    insertions: ins,
  }
}

export function charErrorRate(ref: string, hyp: string): ErrorRate {
  const r = [...tokenize(ref).join(' ')]
  const h = [...tokenize(hyp).join(' ')]
  if (r.length === 0) {
    return {
      rate: h.length === 0 ? 0 : 1,
      refUnits: 0,
      hypUnits: h.length,
      substitutions: 0,
      deletions: 0,
      insertions: h.length,
    }
  }
  const { distance, sub, del, ins } = levenshtein(r, h)
  return {
    rate: distance / r.length,
    refUnits: r.length,
    hypUnits: h.length,
    substitutions: sub,
    deletions: del,
    insertions: ins,
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}
