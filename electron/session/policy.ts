/**
 * What to do about the model's opinion, at this moment.
 *
 * Pure on purpose: the rules that decide whether music changes are the ones
 * that make a session feel composed or jarring, so they are testable without a
 * player, a model or a renderer. The model says which track fits; this says
 * whether now is a moment to act on it.
 */

export type ActionKind = 'hold' | 'queue-next' | 'play-now'

export interface Action {
  kind: ActionKind
  reason: string
}

export interface DecisionInput {
  /** Model probability that the candidate is the right track. */
  probability: number
  /** The candidate's mood is the mood already playing. */
  sameScene: boolean
  /** The scene change is categorical (calm → combat), not a variation. */
  categorical: boolean
  /** Milliseconds left on the current track, or null when nothing plays. */
  msUntilTrackEnd: number | null
  /** Milliseconds since the last automatic change. */
  msSinceLastChange: number
  autopilot: boolean
  /** The DM has taken playback by hand. */
  override: boolean
}

export interface PolicyConfig {
  /** How long before the end to pick the next track. */
  boundaryLeadMs: number
  /** Probability needed to pick the next track at a boundary. */
  boundaryMinProbability: number
  /** Probability needed to cut the current track short. */
  interruptMinProbability: number
  /** Minimum time between automatic changes. */
  minDwellMs: number
}

export const DEFAULT_POLICY: PolicyConfig = {
  boundaryLeadMs: 20_000,
  boundaryMinProbability: 0.5,
  interruptMinProbability: 0.9,
  minDwellMs: 60_000,
}

/**
 * Boundary changes are cheap: the track is ending, the crossfade hides the
 * seam, and a near-miss costs nothing. Interrupts are expensive: they cut a
 * scene short, so they need a categorical change and a much higher bar.
 */
export function decideAction(input: DecisionInput, config: PolicyConfig = DEFAULT_POLICY): Action {
  if (input.override) return { kind: 'hold', reason: 'the DM has taken playback' }
  if (!input.autopilot) return { kind: 'hold', reason: 'autopilot is off' }

  if (input.msUntilTrackEnd === null) {
    // Nothing is playing: starting a track is always a boundary in spirit.
    return input.probability >= config.boundaryMinProbability
      ? { kind: 'queue-next', reason: 'nothing is playing' }
      : { kind: 'hold', reason: 'no track fits well enough to start' }
  }

  if (input.sameScene) return { kind: 'hold', reason: 'the scene has not changed' }

  if (input.msUntilTrackEnd <= config.boundaryLeadMs) {
    return input.probability >= config.boundaryMinProbability
      ? { kind: 'queue-next', reason: 'the track is ending, so this is the moment to change' }
      : { kind: 'hold', reason: 'the track is ending but no candidate fits well enough' }
  }

  if (!input.categorical) {
    return { kind: 'hold', reason: 'a new track can wait for the boundary' }
  }

  if (input.msSinceLastChange < config.minDwellMs) {
    return { kind: 'hold', reason: 'too soon after the last change' }
  }

  return input.probability >= config.interruptMinProbability
    ? { kind: 'play-now', reason: 'the scene changed categorically and the model is sure' }
    : { kind: 'hold', reason: 'the scene changed but the model is not sure enough to cut in' }
}
