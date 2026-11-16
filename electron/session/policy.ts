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
  /** How many times more likely the top candidate is than the second. */
  trackRatio: number
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
  /** Probability needed to replace the cue at a boundary. */
  boundaryMinProbability: number
  /** Margin over the runner-up a boundary change needs as well. */
  boundaryMinRatio: number
  /**
   * A categorical scene change justifies a new cue at a lower probability: the
   * music that was right for a campfire is wrong for a fight.
   */
  boundaryCategoricalProbability: number
  /** Probability needed to cut the current track short. */
  interruptMinProbability: number
  /** Margin over the runner-up a cut-in needs as well. */
  interruptMinRatio: number
  /** Minimum time between automatic changes. */
  minDwellMs: number
}

export const DEFAULT_POLICY: PolicyConfig = {
  boundaryLeadMs: 20_000,
  // The DM's default is to keep the current cue playing (loop single). Changing
  // it should be the exception, so the bar is a clear read, not the least bad
  // option of twenty.
  boundaryMinProbability: 0.4,
  boundaryMinRatio: 1.5,
  boundaryCategoricalProbability: 0.3,
  // Cutting a scene short is the expensive move: be sure, not merely curious.
  interruptMinProbability: 0.9,
  interruptMinRatio: 2,
  minDwellMs: 60_000,
}

/**
 * Boundary changes are a judgement call: the current track can keep looping, so
 * "hold" costs nothing. A cut-in is expensive: it ends a scene early. Both
 * therefore need a clear read. The difference is that a categorical scene
 * change lowers the boundary bar, because the cue that fits the old scene is
 * now wrong.
 */
export function decideAction(input: DecisionInput, config: PolicyConfig = DEFAULT_POLICY): Action {
  if (input.override) return { kind: 'hold', reason: 'the DM has taken playback' }
  if (!input.autopilot) return { kind: 'hold', reason: 'autopilot is off' }

  const confident = input.probability >= config.boundaryMinProbability && input.trackRatio >= config.boundaryMinRatio
  const sceneShifted = input.categorical && input.probability >= config.boundaryCategoricalProbability

  if (input.msUntilTrackEnd === null) {
    // Nothing is playing, so there is nothing to repeat: holding here is silence.
    // Start the session with the model's best cue; the DM can pause or skip.
    return { kind: 'queue-next', reason: 'nothing is playing, so a cue starts the session' }
  }

  if (input.msUntilTrackEnd <= config.boundaryLeadMs) {
    if (sceneShifted) {
      return { kind: 'queue-next', reason: 'the scene changed categorically, so the cue should change' }
    }
    return confident
      ? { kind: 'queue-next', reason: 'the track is ending and this pick is clearly ahead' }
      : { kind: 'hold', reason: 'the track is ending but nothing stands out, so it repeats' }
  }

  // Mid-track with the same scene: nothing to do until the boundary arrives.
  if (input.sameScene) return { kind: 'hold', reason: 'the scene has not changed' }

  if (!input.categorical) {
    return { kind: 'hold', reason: 'a new track can wait for the boundary' }
  }

  if (input.msSinceLastChange < config.minDwellMs) {
    return { kind: 'hold', reason: 'too soon after the last change' }
  }

  return input.probability >= config.interruptMinProbability && input.trackRatio >= config.interruptMinRatio
    ? { kind: 'play-now', reason: 'the scene changed categorically and the model is sure' }
    : { kind: 'hold', reason: 'the scene changed but the model is not sure enough to cut in' }
}
