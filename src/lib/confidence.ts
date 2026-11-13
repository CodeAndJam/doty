/**
 * TypeSafe's Choice confidence: how far the top probability sits above an even
 * split, on a 0–1 scale that means the same thing whatever the option count.
 *
 * It is deliberately NOT what autopilot thresholds. Their docs are explicit that
 * for a Choice the number to act on is the selected option's probability, since
 * that reads as risk ("under 10% chance of the wrong track"); confidence only
 * says how settled the choice is.
 */
export function choiceConfidence(probabilities: number[]): number {
  const n = probabilities.length
  if (n === 0) return 0
  const top = Math.max(...probabilities)
  if (n === 1) return top
  const even = 1 / n
  return Math.max(0, (top - even) / (1 - even))
}

/** Per-option probability for display: one decimal under 10%, whole above. */
export function formatProbability(p: number): string {
  if (!(p > 0)) return '0%'
  const pct = p * 100
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`
}
