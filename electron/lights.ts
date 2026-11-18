/**
 * The light side of the session: one Area Preset per confirmed Session Scene,
 * with the DM's hand winning for a while.
 *
 * The rules live here — palette, dwell, the fifteen-minute pause, the restore —
 * and the Home Assistant port is injected, so none of them need a socket to be
 * tested. `home-assistant.ts` owns the wire; this file owns the judgement.
 */
import { moodFromHint, type Preset, presetFor, type Rgb } from '../src/lib/lightsPreset'
import type { DecisionRow } from './session/store'

export type { Preset, Rgb } from '../src/lib/lightsPreset'
export { moodFromHint, presetFor }

export type PresetProducer = 'mood' | 'hint'

/** What a light looked like before Doty touched it. */
export interface LightState {
  entityId: string
  on: boolean
  brightnessPct?: number
  rgb?: Rgb
}

export interface LightPort {
  states(): Promise<LightState[]>
  apply(preset: Preset): Promise<void>
  applyStates(states: LightState[]): Promise<void>
}

export interface LightObservation {
  mood: string
  intensity: number
  /** The decision model's probability for that mood. */
  probability: number
  producer: PresetProducer
}

export interface LightDirectorState {
  mood: string | null
  producer: PresetProducer | null
  paused: boolean
  pausedUntil: number | null
}

export interface LightDirectorDeps {
  now(): number
  record(row: DecisionRow): void
  /** The DM's "hands off" window. */
  pauseMs?: number
  /** Minimum time between light changes, so the room does not flicker. */
  dwellMs?: number
}

export interface LightDirector {
  startSession(): Promise<void>
  endSession(): Promise<void>
  observe(observation: LightObservation): Promise<void>
  /** The DM changed a light in the Area by hand (app, switch, voice, automation). */
  noteManualChange(): void
  resume(): void
  state(): LightDirectorState
}

export function createLightDirector(port: LightPort, deps: LightDirectorDeps): LightDirector {
  const pauseMs = deps.pauseMs ?? 15 * 60_000
  const dwellMs = deps.dwellMs ?? 25_000

  let snapshot: LightState[] | null = null
  let lastAppliedAt = 0
  let lastWriteAt = 0
  let lastManualAt = 0
  let mood: string | null = null
  let producer: PresetProducer | null = null
  let pausedUntil: number | null = null

  const paused = () => pausedUntil !== null && deps.now() < pausedUntil

  function log(action: string, reason: string, probability: number, source: 'auto' | 'manual' | 'hint') {
    deps.record({
      at: deps.now(),
      kind: 'light',
      action,
      reason,
      track: null,
      probability,
      mood,
      source,
    })
  }

  return {
    async startSession() {
      snapshot = await port.states()
      lastAppliedAt = 0
      mood = null
      producer = null
    },

    async endSession() {
      const wasOurs = lastWriteAt > 0 && lastWriteAt > lastManualAt
      if (snapshot && wasOurs) await port.applyStates(snapshot)
      snapshot = null
      lastWriteAt = 0
      lastManualAt = 0
      mood = null
      producer = null
      pausedUntil = null
    },

    async observe(observation) {
      const now = deps.now()
      if (paused()) return
      if (observation.mood === mood) return
      if (now - lastAppliedAt < dwellMs) return

      mood = observation.mood
      producer = observation.producer
      lastAppliedAt = now
      lastWriteAt = now
      await port.apply(presetFor(observation.mood, observation.intensity))
      // ADR-0005: a hint-attributed preset is labelled as one, not as the model's.
      log(
        observation.mood,
        observation.producer,
        observation.probability,
        observation.producer === 'hint' ? 'hint' : 'auto',
      )
    },

    noteManualChange() {
      pausedUntil = deps.now() + pauseMs
      lastManualAt = deps.now()
      log('pause', 'the DM took the light', 0, 'manual')
    },

    resume() {
      pausedUntil = null
      log('resume', 'the DM resumed auto', 0, 'manual')
    },

    state() {
      return { mood, producer, paused: paused(), pausedUntil }
    },
  }
}
