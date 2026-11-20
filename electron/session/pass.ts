/**
 * One session pass: ask the decision model, fold its mood into the scene, and
 * return the plan the renderer executes.
 *
 * This used to be 110 lines inside the `sessionEvaluate` IPC handler, where the
 * only way to test "holds log at most every 30 s" was to start Electron. The
 * rules themselves live in `director.ts` and `policy.ts`; this module owns the
 * coordination around them — the scene between calls, the change clock, the
 * logging throttle, and one pass at a time — with its dependencies injected.
 */

import { planStep } from './director'
import { MOODS } from './moods'
import { DEFAULT_POLICY } from './policy'
import { learnedPick } from './preferences'
import type { Scene } from './scene'
import type { DecisionRow, SessionStore } from './store'

export interface PassRequest {
  state: string
  candidates: string[]
  paths: string[]
  msUntilTrackEnd: number | null
  /** The DM's switch for automatic music changes. */
  musicEnabled: boolean
  /** The DM's threshold from Settings; absent keeps the policy default. */
  confidenceThreshold?: number
}

export interface PassDeps {
  evaluate(state: string, candidates: string[]): Promise<{ tracks: number[]; moods: number[] }>
  store: Pick<SessionStore, 'recordScene' | 'recordDecision' | 'recentPreferences'>
  now(): number
  /** A confirmed scene, for whoever also dresses the room. */
  onScene?(scene: Scene, moodProbability: number): void
}

export interface PassResult {
  tracks: number[]
  moods: number[]
  plan: {
    scene: string
    action: DecisionRow['action']
    reason: string
    track: string | null
  } | null
}

export interface SessionPass {
  run(request: PassRequest): Promise<PassResult>
}

export function createSessionPass(deps: PassDeps): SessionPass {
  let liveScene: Scene | null = null
  let lastChangeAt = 0
  let lastLoggedAt = 0
  /** One pass at a time; later requests replace each other rather than queueing. */
  let running = false
  let queued: PassRequest | null = null
  let waiting: Array<{ resolve: (result: PassResult) => void; reject: (reason: unknown) => void }> = []

  async function pass(request: PassRequest): Promise<PassResult> {
    const { tracks, moods } = await deps.evaluate(request.state, request.candidates)
    if (moods.length === 0) return { tracks, moods, plan: null }

    let best = 0
    for (let i = 1; i < moods.length; i++) if (moods[i] > moods[best]) best = i
    const now = deps.now()

    // The margin the policy gates on: the runner-up is the strongest competitor.
    let top = tracks.length > 0 ? tracks[0] : 0
    let second = 0
    for (let i = 1; i < tracks.length; i++) {
      if (tracks[i] > top) {
        second = top
        top = tracks[i]
      } else if (tracks[i] > second) {
        second = tracks[i]
      }
    }

    // Where the model cannot decide, prefer what the DM chose for this scene.
    const learned = learnedPick({
      probabilities: tracks,
      paths: request.paths,
      preferences: deps.store.recentPreferences(200),
      scene: liveScene?.mood ?? MOODS[best] ?? null,
    })
    // The learned pick changes *which* track, never the probability: rewriting
    // the numbers would fake a confidence the model never had.
    const pickIndex =
      learned && learned.path ? request.paths.indexOf(learned.path) : tracks.indexOf(Math.max(...tracks))
    const step = planStep({
      previous: liveScene,
      observation: {
        mood: MOODS[best] ?? 'exploration',
        intensity: 0.5,
        moodProbability: moods[best] ?? 0,
        trackProbability: tracks.length > 0 ? Math.max(...tracks) : 0,
        secondTrackProbability: second,
      },
      now,
      msUntilTrackEnd: request.msUntilTrackEnd,
      msSinceLastChange: now - lastChangeAt,
      musicEnabled: request.musicEnabled,
      // Settings must move the real gate, not just the label under it. The
      // threshold is the cut-in bar; boundaries always pick the next track.
      policy: {
        ...DEFAULT_POLICY,
        interruptMinProbability: request.confidenceThreshold ?? DEFAULT_POLICY.interruptMinProbability,
      },
    })

    const sceneMoved = liveScene === null || step.scene.mood !== liveScene.mood
    if (sceneMoved) {
      deps.store.recordScene({
        session: 'live',
        mood: step.scene.mood,
        intensity: step.scene.intensity,
        startedAt: step.scene.since,
      })
      deps.onScene?.(step.scene, moods[best] ?? 0)
    }
    // The clock gates the change cooldown, so it only moves when music would.
    if (step.action.kind !== 'hold') lastChangeAt = now
    liveScene = step.scene

    // Holds are main's to log (throttled: one per half minute). Actions are logged
    // by the renderer once it has actually executed them, so `autoActions` counts
    // changes that happened rather than changes that were proposed.
    if (step.action.kind === 'hold' && now - lastLoggedAt > 30_000) {
      lastLoggedAt = now
      deps.store.recordDecision({
        at: now,
        kind: 'music',
        action: step.action.kind,
        reason: step.action.reason,
        track: pickIndex >= 0 ? (request.paths[pickIndex] ?? null) : null,
        probability: best >= 0 ? (tracks[best] ?? 0) : 0,
        mood: step.scene.mood,
        source: 'auto',
      })
    }

    return {
      tracks,
      moods,
      plan: {
        scene: step.scene.mood,
        action: step.action.kind,
        reason: step.action.reason,
        track: pickIndex >= 0 ? (request.paths[pickIndex] ?? null) : null,
      },
    }
  }

  /**
   * A transcript window updates every 1.5 s; the decision model may take longer.
   * Run one pass at a time, and when requests arrive meanwhile keep only the
   * newest: a stale state would produce a decision the table has already moved
   * past, and a backlog makes every answer arrive late.
   */
  async function drain(): Promise<void> {
    running = true
    try {
      while (queued) {
        const request = queued
        queued = null
        const batch = waiting
        waiting = []
        try {
          const result = await pass(request)
          for (const waiter of batch) waiter.resolve(result)
        } catch (reason) {
          for (const waiter of batch) waiter.reject(reason)
        }
      }
    } finally {
      running = false
    }
  }

  return {
    run(request) {
      queued = request
      return new Promise<PassResult>((resolve, reject) => {
        waiting.push({ resolve, reject })
        if (!running) void drain()
      })
    },
  }
}
