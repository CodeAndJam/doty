/**
 * One step of the session loop: fold the model's mood into the scene, then ask
 * the policy whether this is a moment to change music.
 *
 * Pure, so the whole "when does the score change" behaviour is testable without
 * a player or a model. Main keeps the scene between calls and returns the plan;
 * the renderer only executes it, so the rules cannot drift between processes.
 */
import { type Action, DEFAULT_POLICY, decideAction, type PolicyConfig } from './policy'
import { DEFAULT_SCENE, foldScene, isCategoricalChange, type Scene, type SceneConfig } from './scene'

export interface Observation {
  mood: string
  intensity: number
  /** Probability of the mood the model picked. */
  moodProbability: number
  /** Probability of the track the model picked. */
  trackProbability: number
}

export interface StepInput {
  previous: Scene | null
  observation: Observation
  now: number
  /** Milliseconds left on the current track, or null when nothing plays. */
  msUntilTrackEnd: number | null
  msSinceLastChange: number
  autopilot: boolean
  override: boolean
  policy?: PolicyConfig
  sceneConfig?: SceneConfig
}

export interface StepResult {
  scene: Scene
  action: Action
  /** True when this is a cut between different kinds of scene. */
  categorical: boolean
  /** True when the model's mood is the one already playing. */
  sameScene: boolean
}

export function planStep(input: StepInput): StepResult {
  const { previous, observation, now } = input
  const scene = foldScene(
    previous,
    { mood: observation.mood, intensity: observation.intensity, probability: observation.moodProbability },
    now,
    input.sceneConfig ?? DEFAULT_SCENE,
  )

  // "Same scene" means the model still sees the mood that is playing. A mood the
  // scene machine has not confirmed yet must not count as a change, or a single
  // misread would still interrupt.
  // With no previous scene there is nothing playing to "keep": this is the start
  // of the session, so the first pick must be allowed through.
  const sameScene = previous !== null && scene.mood === previous.mood
  const categorical = previous !== null && isCategoricalChange(previous.mood, observation.mood)

  const action = decideAction(
    {
      probability: observation.trackProbability,
      sameScene,
      categorical,
      msUntilTrackEnd: input.msUntilTrackEnd,
      msSinceLastChange: input.msSinceLastChange,
      autopilot: input.autopilot,
      override: input.override,
    },
    input.policy ?? DEFAULT_POLICY,
  )

  return { scene, action, categorical, sameScene }
}
