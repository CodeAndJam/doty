/**
 * The lighting service: config, connection, the director, and what the renderer
 * is told. Everything the app can do with a room passes through here.
 *
 * Session start and end belong to whoever owns the recording; `startSession`
 * and `endSession` are the two calls it makes.
 */

import { moodFromHint, presetFor } from '../src/lib/lightsPreset'
import type { LightStatus, LightsState } from '../src/types'
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
      lights: lights.map((light) => ({ entityId: light.entityId, name: light.name, on: light.state === 'on' })),
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

    async setPower(on) {
      if (!client) return publish()
      director?.noteManualChange()
      if (on) await client.apply(entityIds(), presetFor('epic', 0.5), TRANSITION_SEC)
      else await client.turnOff(entityIds(), TRANSITION_SEC)
      logPreset(on ? 'on' : 'off', 'the DM switched the room')
      await refresh()
      return publish()
    },

    async setBrightness(percent) {
      if (!client) return publish()
      director?.noteManualChange()
      const level = Math.min(100, Math.max(1, Math.round(percent)))
      const { rgb } = presetFor(mood ?? 'epic', 0.5)
      await client.apply(entityIds(), { rgb, brightnessPct: level }, TRANSITION_SEC)
      logPreset('brightness', 'the DM moved the slider')
      await refresh()
      return publish()
    },

    async setMood(nextMood) {
      if (!client) return publish()
      director?.noteManualChange()
      await client.apply(entityIds(), presetFor(nextMood, 0.6), TRANSITION_SEC)
      remember(nextMood, 'mood')
      logPreset(nextMood, 'the DM picked a colour')
      await refresh()
      return publish()
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
