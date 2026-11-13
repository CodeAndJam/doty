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
