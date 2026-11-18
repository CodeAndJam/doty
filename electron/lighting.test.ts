import { describe, expect, it } from 'vitest'
import type { HaClient, HaLight } from './home-assistant'
import { createLighting } from './lighting'
import type { DecisionRow, SessionLightsRow } from './session/store'

const lights: HaLight[] = [
  {
    entityId: 'light.desk',
    name: 'Desk',
    state: 'on',
    brightnessPct: 40,
    rgb: [10, 20, 30],
    colorModes: ['rgb'],
    effectList: ['rainbow', 'candle'],
    effect: null,
  },
  {
    entityId: 'light.ceiling',
    name: 'Ceiling',
    state: 'on',
    brightnessPct: 70,
    colorModes: ['brightness'],
    effectList: [],
    effect: null,
  },
]

function rig() {
  const applied: Array<{ ids: string[]; preset: Record<string, unknown> }> = []
  const off: string[][] = []
  const rows: DecisionRow[] = []
  const settings = new Map<string, string>([
    ['lightUrl', 'http://127.0.0.1:8123'],
    ['lightAuto', 'true'],
  ])
  const sessionRows = new Map<string, SessionLightsRow>()
  const client: HaClient = {
    areas: async () => [{ areaId: 'office', name: 'Office' }],
    lights: async () => lights,
    apply: async (ids, preset) => {
      applied.push({ ids, preset: preset as Record<string, unknown> })
    },
    turnOff: async (ids) => {
      off.push(ids)
    },
    applyStates: async () => {},
    onExternalChange: () => () => {},
    onClose: () => () => {},
    close: () => {},
  }

  const lighting = createLighting({
    getSetting: (key, fallback) => settings.get(key) ?? fallback,
    setSetting: (key, value) => settings.set(key, String(value)),
    saveToken: async () => {},
    loadToken: async () => 'token',
    clearToken: () => {},
    connect: async () => client,
    sessionStore: {
      getLights: (session) => sessionRows.get(session) ?? null,
      setLights: (entry) => sessionRows.set(entry.session, entry),
      recordDecision: (entry) => rows.push(entry),
    },
    now: () => 1_000_000,
    emit: () => {},
  })

  return { lighting, applied, off, rows }
}

describe('lighting service', () => {
  it('shows each light as the panel needs it', async () => {
    const { lighting } = rig()
    const state = await lighting.state(null)
    expect(state.lights[0]).toMatchObject({
      entityId: 'light.desk',
      brightnessPct: 40,
      rgb: [10, 20, 30],
      canColor: true,
      effectList: ['rainbow', 'candle'],
    })
    expect(state.lights[1]).toMatchObject({ entityId: 'light.ceiling', canColor: false, effectList: [] })
  })

  it('switches one light without touching its neighbours', async () => {
    const { lighting, off, applied, rows } = rig()
    await lighting.state(null)
    await lighting.setLight('light.desk', { on: false })

    expect(off).toEqual([['light.desk']])
    expect(applied).toHaveLength(0)
    expect(rows.some((row) => row.kind === 'light' && row.action === 'off')).toBe(true)
  })

  it('sends only what the light advertises', async () => {
    const { lighting, applied } = rig()
    await lighting.state(null)

    await lighting.setLight('light.ceiling', { on: true, brightnessPct: 55, rgb: [1, 2, 3], effect: 'rainbow' })
    expect(applied[0]).toEqual({ ids: ['light.ceiling'], preset: { brightnessPct: 55 } })

    await lighting.setLight('light.desk', { on: true, effect: 'rainbow' })
    expect(applied[1]).toEqual({ ids: ['light.desk'], preset: { effect: 'rainbow' } })
  })
})
