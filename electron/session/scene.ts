/**
 * The scene, as the session currently understands it.
 *
 * Every model pass is an independent draw, so a single misclassification would
 * change the score. A scene therefore only changes when a new mood repeats, and
 * never before it has been given time to establish itself.
 */

export interface SceneObservation {
  mood: string
  intensity: number
  /** Model probability for the observed mood. */
  probability: number
}

export interface Scene {
  mood: string
  intensity: number
  /** When the current mood started. */
  since: number
  /** A mood waiting to be confirmed. */
  candidate?: { mood: string; count: number }
}

export interface SceneConfig {
  /** Minimum time a mood must hold before another can replace it. */
  minDwellMs: number
  /** Observations a new mood needs before it replaces the current one. */
  confirmations: number
}

export const DEFAULT_SCENE: SceneConfig = { minDwellMs: 60_000, confirmations: 2 }

/** Moods whose difference is a scene cut rather than a shade of the same scene. */
const CATEGORICAL: Record<string, string[]> = {
  combat: ['peaceful', 'tavern', 'celebration', 'mystery', 'exploration'],
  peaceful: ['combat', 'horror', 'chase'],
  tavern: ['combat', 'horror', 'chase'],
  horror: ['celebration', 'tavern', 'peaceful'],
}

/** True when moving from `from` to `to` is a cut, not a change of intensity. */
export function isCategoricalChange(from: string, to: string): boolean {
  return (CATEGORICAL[to] ?? []).includes(from)
}

export function foldScene(
  previous: Scene | null,
  observation: SceneObservation,
  now: number,
  config: SceneConfig = DEFAULT_SCENE,
): Scene {
  if (!previous) return { mood: observation.mood, intensity: observation.intensity, since: now }

  if (observation.mood === previous.mood) {
    return { ...previous, intensity: observation.intensity, candidate: undefined }
  }

  const count = previous.candidate?.mood === observation.mood ? previous.candidate.count + 1 : 1

  // A new mood must repeat, and the current one must have had its time.
  const confirmed = count >= config.confirmations
  const dwelled = now - previous.since >= config.minDwellMs

  if (confirmed && dwelled) {
    return { mood: observation.mood, intensity: observation.intensity, since: now }
  }

  return { ...previous, candidate: { mood: observation.mood, count } }
}
