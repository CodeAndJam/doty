/**
 * The lighting service: config, connection, the director, and what the renderer
 * is told. Everything the app can do with a room passes through here.
 *
 * Session start and end belong to whoever owns the recording; `startSession`
 * and `endSession` are the two calls it makes.
 */

import { Effect, Semaphore } from 'effect'
import { moodFromHint, presetFor } from '../src/lib/lightsPreset'
import type { LightPatch, LightStatus, LightsState } from '../src/types'
import type { HaArea, HaClient, HaLight } from './home-assistant'
import { createLightDirector, type LightDirector, type PresetProducer } from './lights'
import type { DecisionRow, SessionLightsRow, SessionStore } from './session/store'

export interface LightingDeps {
  getSetting(key: string, fallback: string): string
  setSetting(key: string, value: string | boolean): void
  saveToken(token: string): Promise<void>
  loadToken(): Promise<string>
  clearToken(): void
  connect(url: string, token: string): Promise<HaClient>
  sessionStore: Pick<SessionStore, 'getLights' | 'setLights' | 'recordDecision'>
  now(): number
  emit(state: LightsState): void
}

export interface Lighting {
  state(session?: string | null): Promise<LightsState>
  configure(input: { url: string; token?: string }): Promise<LightsState>
  clear(): Promise<LightsState>
  setArea(session: string | null, areaId: string): Promise<LightsState>
  setAuto(enabled: boolean): Promise<LightsState>
  setPower(on: boolean): Promise<LightsState>
  setBrightness(percent: number): Promise<LightsState>
  /** One light, by hand: on/off, level, colour or effect. */
  setLight(entityId: string, patch: LightPatch): Promise<LightsState>
  /**
   * Breathing animation for lamps with no native effects. App-side: a stream of
   * `turn_on` calls, so it is the chattiest thing in the app and stops on any
   * other manual change.
   */
  setPulse(enabled: boolean): Promise<LightsState>
  setMood(mood: string): Promise<LightsState>
  setHint(session: string | null, hint: string): Promise<LightsState>
  resume(): Promise<LightsState>
  startSession(): Promise<void>
  endSession(): Promise<void>
  /** Fed by the session pass with the scene it just confirmed. */
  observeScene(mood: string, intensity: number, probability: number): Promise<void>
  /** "The DM's connection dropped" -> what the panel should say. */
  current(): LightsState
}

const TRANSITION_SEC = 3

/** Modes a light must advertise before Doty sends it a colour. */
const COLOR_MODES = new Set(['rgb', 'rgbw', 'rgbww', 'hs', 'xy'])

export function createLighting(deps: LightingDeps): Lighting {
  let client: HaClient | null = null
  let director: LightDirector | null = null
  let detachClient: Array<() => void> = []
  let connecting: Promise<HaClient | null> | null = null
  let status: LightStatus = 'off'
  let lastError: string | undefined
  let areas: HaArea[] = []
  let lights: HaLight[] = []
  let areaId = deps.getSetting('lightArea', '')
  let auto = deps.getSetting('lightAuto', 'true') === 'true'
  let mood: string | null = null
  let producer: PresetProducer | null = null
  let sessionKey: string | null = null
  let pulsing = false
  let pulseTimer: ReturnType<typeof setInterval> | null = null
  let pulsePhase = 0
  let pulseInFlight = false

  const url = () => deps.getSetting('lightUrl', '')
  const configured = () => url().length > 0
  /** Every light must take a colour: one that cannot would reject the command. */
  const canColor = () =>
    lights.length > 0 && lights.every((light) => light.colorModes.some((mode) => COLOR_MODES.has(mode)))

  function snapshot(): LightsState {
    const row = sessionKey ? deps.sessionStore.getLights(sessionKey) : null
    const pausedUntil = director?.state().pausedUntil ?? null
    return {
      configured: configured(),
      status,
      error: lastError,
      url: url(),
      areas,
      areaId: row?.areaId || areaId,
      // A session's own switch wins over the app-wide default.
      auto,
      hint: row?.hint ?? '',
      mood,
      producer,
      pausedUntil,
      canColor: canColor(),
      pulse: pulsing,
      lights: lights.map((light) => ({
        entityId: light.entityId,
        name: light.name,
        on: light.state === 'on',
        brightnessPct: light.brightnessPct ?? null,
        rgb: light.rgb ?? null,
        canColor: light.colorModes.some((mode) => COLOR_MODES.has(mode)),
        effectList: light.effectList,
        effect: light.effect,
      })),
    }
  }

  function publish(): LightsState {
    const state = snapshot()
    deps.emit(state)
    return state
  }

  function record(row: DecisionRow) {
    deps.sessionStore.recordDecision(row)
  }

  function remember(nextMood: string | null, by: PresetProducer | null) {
    mood = nextMood
    producer = by
  }

  function entityIds(): string[] {
    return lights.map((light) => light.entityId)
  }

  // `lights` is the panel's view of the Area. Rebuilt by connect(), setArea(),
  // refresh() and every write; anything that changes a light must call one.
  async function refresh(): Promise<void> {
    if (client && areaId) lights = await client.lights(areaId)
  }

  function logPreset(action: string, reason: string) {
    record({ at: deps.now(), kind: 'light', action, reason, track: null, probability: 0, mood, source: 'manual' })
  }

  // A lamp with no `effect_list` can only be animated by writing to it, so the
  // breath is a stream of turn_on calls. Ten a second with a four-second cycle
  // keeps each step under ~3 % brightness: at 5 Hz the lamp stepped visibly.
  // A tick is skipped while the previous call is in flight, so a slow lamp gets
  // motion rather than a backlog.
  const PULSE_TICK_MS = 100
  const PULSE_STEPS = 40
  const PULSE_LOW = 30
  const PULSE_HIGH = 65
  const PULSE_FROM: [number, number, number] = [0, 190, 190]
  const PULSE_TO: [number, number, number] = [110, 40, 200]

  function stopPulse() {
    if (pulseTimer) clearInterval(pulseTimer)
    pulseTimer = null
    pulseInFlight = false
    pulsing = false
  }

  function startPulse() {
    if (!client || lights.length === 0) return
    stopPulse()
    pulsing = true
    pulsePhase = 0
    let lastSent = ''
    director?.noteManualChange()
    logPreset('pulse', 'the DM asked the lights to breathe')
    pulseTimer = setInterval(() => {
      if (!client || pulseInFlight) return
      pulsePhase += (2 * Math.PI) / PULSE_STEPS
      const breath = (Math.sin(pulsePhase) + 1) / 2
      const level = Math.round(PULSE_LOW + breath * (PULSE_HIGH - PULSE_LOW))
      // Colour moves at half the speed of brightness: one teal→violet→teal arc
      // per breath reads as living light instead of a blinking lamp.
      const tint = (Math.sin(pulsePhase / 2) + 1) / 2
      const rgb = PULSE_FROM.map((from, i) => Math.round(from + (PULSE_TO[i] - from) * tint)) as [
        number,
        number,
        number,
      ]
      // Sine peaks repeat the same rounded value for a few ticks; not sending
      // them keeps the device quieter without changing the motion.
      const key = `${level}|${rgb.join(',')}`
      if (key === lastSent) return
      lastSent = key
      pulseInFlight = true
      void client
        .apply(entityIds(), { rgb, brightnessPct: level }, 0)
        .catch(() => {})
        .finally(() => {
          pulseInFlight = false
        })
    }, PULSE_TICK_MS)
  }

  function attach(next: HaClient, area: string) {
    // A new Area is a new director and new listeners: leaving the old ones
    // attached logs every human change twice.
    for (const detach of detachClient) detach()
    const port = {
      states: async () =>
        next.lights(area).then((list) =>
          list.map((l) => ({
            entityId: l.entityId,
            on: l.state === 'on',
            brightnessPct: l.brightnessPct,
            rgb: l.rgb,
          })),
        ),
      apply: (preset: { rgb: [number, number, number]; brightnessPct: number }) =>
        next.apply(entityIds(), { ...preset, rgb: canColor() ? preset.rgb : undefined }, TRANSITION_SEC),
      applyStates: (
        states: Array<{ entityId: string; on: boolean; brightnessPct?: number; rgb?: [number, number, number] }>,
      ) => next.applyStates(states),
    }
    const created = createLightDirector(port, { now: deps.now, record })
    director = created
    const offExternal = next.onExternalChange((entityId) => {
      if (!lights.some((light) => light.entityId === entityId)) return
      created.noteManualChange()
      // The wall switch moved it; the panel must not keep showing the old state.
      void refresh().then(publish, () => {})
    })
    const offClose = next.onClose(() => {
      // Drop the dead socket so the next state() call reconnects instead of
      // handing back a client that can only reject.
      if (client === next) client = null
      status = 'needs-reconnect'
      void publish()
    })
    detachClient = [offExternal, offClose]
  }

  async function doConnect(): Promise<HaClient | null> {
    if (!configured()) {
      status = 'off'
      return null
    }
    const token = await deps.loadToken()
    if (!token) {
      status = 'needs-reconnect'
      return null
    }
    status = 'connecting'
    lastError = undefined
    publish()
    try {
      const next = await deps.connect(url(), token)
      client = next
      status = 'connected'
      areas = await next.areas()
      if (!areaId && areas.length > 0) areaId = areas[0].areaId
      lights = areaId ? await next.lights(areaId) : []
      attach(next, areaId)
      return next
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      status = 'needs-reconnect'
      return null
    } finally {
      publish()
    }
  }

  /** One attempt at a time: startup and the panel both ask, and two sockets is a leak. */
  async function connect(): Promise<HaClient | null> {
    if (connecting) return connecting
    connecting = doConnect().finally(() => {
      connecting = null
    })
    return connecting
  }

  /**
   * Every DM write runs alone. Two IPC calls against one socket used to
   * interleave stopPulse/apply/refresh, so a slow write published the state the
   * previous one had produced.
   */
  const gate = Effect.runSync(Semaphore.make(1))

  function serial<A>(body: () => Promise<A>): Promise<A> {
    return Effect.runPromise(gate.withPermit(Effect.promise(body)))
  }

  /** One body for every DM change: quiet the breath, write, refresh, tell the panel. */
  function command(write: (ha: HaClient) => Promise<void>, log: [action: string, reason: string] | null) {
    const ha = client
    if (!ha) return Promise.resolve(publish())
    return serial(async () => {
      stopPulse()
      director?.noteManualChange()
      await write(ha)
      if (log) logPreset(log[0], log[1])
      await refresh()
      return publish()
    })
  }

  return {
    current: snapshot,

    async state(session) {
      // A null only means "no session yet" from the Settings panel; it must not
      // erase the session the lights pane already announced.
      if (typeof session === 'string' && session.length > 0) sessionKey = session
      if (!client && configured()) await connect()
      return snapshot()
    },

    async configure(input) {
      stopPulse()
      deps.setSetting('lightUrl', input.url.trim().replace(/\/+$/, ''))
      if (input.token !== undefined) await deps.saveToken(input.token.trim())
      for (const detach of detachClient) detach()
      detachClient = []
      client?.close()
      client = null
      await connect()
      return publish()
    },

    async clear() {
      stopPulse()
      deps.clearToken()
      deps.setSetting('lightUrl', '')
      for (const detach of detachClient) detach()
      detachClient = []
      client?.close()
      client = null
      status = 'off'
      lastError = undefined
      areas = []
      lights = []
      director = null
      remember(null, null)
      return publish()
    },

    async setArea(session, nextAreaId) {
      stopPulse()
      areaId = nextAreaId
      deps.setSetting('lightArea', nextAreaId)
      if (session) {
        const row = deps.sessionStore.getLights(session)
        deps.sessionStore.setLights({
          session,
          areaId: nextAreaId,
          hint: row?.hint ?? '',
          pinned: row?.pinned ?? false,
        })
      }
      if (client) {
        lights = await client.lights(nextAreaId)
        attach(client, nextAreaId)
        // A different room is a different snapshot to put back.
        await director?.startSession()
      }
      return publish()
    },

    async setAuto(enabled) {
      auto = enabled
      deps.setSetting('lightAuto', enabled)
      return publish()
    },

    setPower(on) {
      return command(
        (ha) =>
          on ? ha.apply(entityIds(), presetFor('epic', 0.5), TRANSITION_SEC) : ha.turnOff(entityIds(), TRANSITION_SEC),
        [on ? 'on' : 'off', 'the DM switched the room'],
      )
    },

    setBrightness(percent) {
      const level = Math.min(100, Math.max(1, Math.round(percent)))
      const { rgb } = presetFor(mood ?? 'epic', 0.5)
      return command(
        (ha) => ha.apply(entityIds(), { rgb, brightnessPct: level }, TRANSITION_SEC),
        ['brightness', 'the DM moved the slider'],
      )
    },

    setPulse(enabled) {
      return serial(async () => {
        stopPulse()
        if (enabled) startPulse()
        else await refresh()
        return publish()
      })
    },

    setMood(nextMood) {
      return command(
        async (ha) => {
          await ha.apply(entityIds(), presetFor(nextMood, 0.6), TRANSITION_SEC)
          remember(nextMood, 'mood')
        },
        [nextMood, 'the DM picked a colour'],
      )
    },

    setLight(entityId, patch) {
      const light = lights.find((entry) => entry.entityId === entityId)
      if (!light) return Promise.resolve(publish())
      // Only send what the light can actually take: a dimmer has no colour and a
      // plain bulb no effect, and Home Assistant rejects the whole call.
      const colors = light.colorModes.some((mode) => COLOR_MODES.has(mode))
      return command(
        (ha) =>
          patch.on === false
            ? ha.turnOff([entityId], TRANSITION_SEC)
            : ha.apply(
                [entityId],
                {
                  rgb: colors ? patch.rgb : undefined,
                  brightnessPct: patch.brightnessPct,
                  effect: light.effectList.length > 0 ? patch.effect : undefined,
                },
                TRANSITION_SEC,
              ),
        patch.on === false
          ? ['off', `the DM switched ${light.name} off`]
          : [patch.effect ?? (patch.rgb ? 'colour' : 'brightness'), `the DM set ${light.name}`],
      )
    },

    async setHint(session, hint) {
      if (session) {
        const row = deps.sessionStore.getLights(session)
        deps.sessionStore.setLights({
          session,
          areaId: row?.areaId || areaId,
          hint,
          pinned: hint.trim().length > 0,
        } satisfies SessionLightsRow)
      }
      const detected = hint.trim() ? moodFromHint(hint) : null
      if (detected && auto && director) {
        await director.observe({ mood: detected, intensity: 0.6, probability: 1, producer: 'hint' })
        remember(detected, 'hint')
      }
      return publish()
    },

    async resume() {
      director?.resume()
      return publish()
    },

    async startSession() {
      if (!client) return
      await director?.startSession()
    },

    async endSession() {
      stopPulse()
      await director?.endSession()
      remember(null, null)
      publish()
    },

    async observeScene(sceneMood, intensity, probability) {
      if (!auto || !director) return
      await director.observe({ mood: sceneMood, intensity, probability, producer: 'mood' })
      remember(sceneMood, 'mood')
      void publish()
    },
  }
}
