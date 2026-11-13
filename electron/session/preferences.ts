/**
 * What the DM chose last time, used only where the model cannot decide.
 *
 * Reweighting the model's probabilities would corrupt the calibration the
 * autopilot threshold depends on, and overruling a confident pick would make the
 * system worse at exactly the moments it is right. So a learned track is used
 * for one job: breaking a tie between the model's top two, in the same scene,
 * among the candidates it was actually offered.
 */

export interface LearnedPreference {
  track: string
  scene: string | null
}

export interface LearnedPick {
  path: string
  reason: string
}

export interface LearnedPickInput {
  probabilities: number[]
  paths: string[]
  /** Newest first, as the store returns them. */
  preferences: LearnedPreference[]
  scene: string | null
  /** Top-two gap, in probability, below which the model is undecided. */
  margin?: number
}

export function learnedPick(input: LearnedPickInput): LearnedPick | null {
  const { probabilities, paths, preferences, scene } = input
  const margin = input.margin ?? 0.02
  if (!scene || probabilities.length < 2) return null

  const sorted = probabilities.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p)
  const gap = sorted[0].p - sorted[1].p
  if (gap > margin) return null

  const remembered = preferences.find((p) => p.scene === scene && paths.includes(p.track))
  if (!remembered) return null

  return {
    path: remembered.track,
    reason: 'learned preference: the model was undecided, and this is what you chose for this scene',
  }
}
