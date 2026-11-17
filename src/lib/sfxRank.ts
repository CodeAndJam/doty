/**
 * When a sound effect may fire without being asked.
 *
 * A wrong sound is more embarrassing than wrong music: music is a bed the DM
 * can talk over, while a badly timed door slam is a joke at the table's expense.
 * So SFX take a much higher bar than music, and silence is always acceptable.
 */

/** Higher than music's 0.9: an unwanted sound is worse than an unwanted track. */
export const SFX_MIN_PROBABILITY = 0.95

export interface Confident {
  path: string
  probability: number
}

/**
 * The effects worth firing, best first. Anything under the bar is dropped rather
 * than ranked — a loud second-best is still a wrong sound.
 */
export function confidentSfx(paths: string[], probabilities: number[], threshold = SFX_MIN_PROBABILITY): Confident[] {
  const out: Confident[] = []
  const n = Math.min(paths.length, probabilities.length)
  for (let i = 0; i < n; i++) {
    if (probabilities[i] >= threshold) out.push({ path: paths[i], probability: probabilities[i] })
  }
  return out.sort((a, b) => b.probability - a.probability)
}

/**
 * The candidates the model chooses between: what the index found nearest the
 * words first, then the keyword shortlist, with no effect listed twice.
 *
 * Neither list is enough alone. Keywords know "sword" and "battle"; the index
 * knows "air" means wind and rain. The model is the judge, so it gets both.
 */
export function mergeSfxCandidates(nearest: string[], heuristic: string[], count: number): string[] {
  const out: string[] = []
  for (const id of [...nearest, ...heuristic]) {
    if (out.length >= count * 2) break
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/** The model's ranking, cut to the column's size. */
export function rankSfxCandidates(paths: string[], probabilities: number[], count: number): string[] {
  return paths
    .map((path, i) => ({ path, probability: probabilities[i] ?? 0 }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, count)
    .map((c) => c.path)
}
