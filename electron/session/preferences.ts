/**
 * What the DM chose (and rejected) before, used only where the model cannot decide.
 *
 * Reweighting the model's probabilities would corrupt the calibration the
 * autopilot threshold depends on, and overruling a confident pick would make the
 * system worse at exactly the moments it is right. So history is used for two
 * jobs only: breaking a tie between the model's top two, and getting a track the
 * DM has skipped twice in the same scene out of the way.
 */

export interface LearnedPreference {
  track: string
  scene: string | null
  /** `reject` means the DM skipped it; anything else means they chose it. */
  source?: 'auto' | 'manual' | 'reject'
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
  /** Rejections in this scene before a track is considered disliked. */
  evidence?: number
}

export function learnedPick(input: LearnedPickInput): LearnedPick | null {
  const { probabilities, paths, preferences, scene } = input
  const margin = input.margin ?? 0.02
  const minimum = input.evidence ?? 2
  if (!scene || probabilities.length < 2) return null

  // Only tracks the model was actually offered can be chosen or rejected.
  const offered = new Set(paths)
  const picks = new Map<string, number>()
  const rejects = new Map<string, number>()
  for (const preference of preferences) {
    if (preference.scene !== scene || !offered.has(preference.track)) continue
    const tally = preference.source === 'reject' ? rejects : picks
    tally.set(preference.track, (tally.get(preference.track) ?? 0) + 1)
  }
  if (picks.size === 0 && rejects.size === 0) return null

  const sorted = probabilities.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p)
  const gap = sorted[0].p - sorted[1].p
  const topPath = paths[sorted[0].i]
  // One skip is noise; two in the same scene is a pattern.
  const topRejected = (rejects.get(topPath) ?? 0) >= minimum

  // A decisive model is only overruled by repeated rejection, never by a tie-break.
  if (gap > margin && !topRejected) return null

  // Net evidence first, then probability. A track skipped `minimum` times in this
  // scene is not offered again unless the DM also chose it at some point.
  let best = -1
  for (let i = 0; i < paths.length; i++) {
    const chosen = picks.get(paths[i]) ?? 0
    const rejected = rejects.get(paths[i]) ?? 0
    if (rejected >= minimum && chosen === 0) continue
    if (best < 0) {
      best = i
      continue
    }
    const net = chosen - rejected
    const bestNet = (picks.get(paths[best]) ?? 0) - (rejects.get(paths[best]) ?? 0)
    if (net > bestNet || (net === bestNet && probabilities[i] > probabilities[best])) best = i
  }
  if (best < 0 || best === sorted[0].i) return null

  return {
    path: paths[best],
    reason: picks.has(paths[best])
      ? 'learned preference: you chose this track for this scene before'
      : "learned preference: you skipped the model's pick for this scene before",
  }
}
