import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { createHaClient, type HaClient, isLanHost, socketUrl } from './home-assistant'

/**
 * A stand-in for Home Assistant's WebSocket API. It speaks only what the client
 * is allowed to depend on: the auth handshake, id-tagged results, and
 * `state_changed` events. If this fake ever disagrees with a real HA, the fake
 * is the thing to fix.
 */
async function fakeHa(options: {
  token?: string
  areas?: unknown[]
  entities?: unknown[]
  devices?: unknown[]
  states?: unknown[]
  /** Message types the fake accepts but never answers. */
  swallow?: string[]
}) {
  const token = options.token ?? 'good-token'
  const wss = new WebSocketServer({ port: 0 })
  await new Promise<void>((resolve) => wss.on('listening', () => resolve()))
  const port = (wss.address() as { port: number }).port
  const calls: Array<Record<string, unknown>> = []
  let socket: import('ws').WebSocket | null = null

  wss.on('connection', (ws) => {
    socket = ws
    ws.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.11.0' }))
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw))
      if (msg.type === 'auth') {
        if (msg.access_token !== token)
          return ws.send(JSON.stringify({ type: 'auth_invalid', message: 'Invalid access token' }))
        return ws.send(JSON.stringify({ type: 'auth_ok', ha_version: '2026.11.0' }))
      }
      calls.push(msg)
      if (options.swallow?.includes(msg.type)) return
      const reply = (result: unknown) => ws.send(JSON.stringify({ id: msg.id, type: 'result', success: true, result }))
      if (msg.type === 'config/area_registry/list') return reply(options.areas ?? [])
      if (msg.type === 'config/entity_registry/list') return reply(options.entities ?? [])
      if (msg.type === 'config/device_registry/list') return reply(options.devices ?? [])
      if (msg.type === 'get_states') return reply(options.states ?? [])
      if (msg.type === 'call_service') return reply({ context: { id: `ours-${msg.id}` } })
      if (msg.type === 'subscribe_events') return reply(null)
      return reply(null)
    })
  })

  const emit = (event: unknown) => socket?.send(JSON.stringify({ id: 99, type: 'event', event }))

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    emit,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate()
        wss.close(() => resolve())
      }),
  }
}

const areas = [
  { area_id: 'office', name: 'Office' },
  { area_id: 'attic', name: 'Attic' },
]
const entities = [
  { entity_id: 'light.desk', area_id: 'office', disabled_by: null, hidden_by: null, name: 'Desk' },
  { entity_id: 'light.office_group', area_id: 'office', disabled_by: null, hidden_by: null, name: 'Office' },
  { entity_id: 'light.attic_bulb', area_id: 'attic', disabled_by: null, hidden_by: null, name: 'Attic bulb' },
  { entity_id: 'switch.lamp', area_id: 'office', disabled_by: null, hidden_by: null, name: 'Lamp plug' },
]
const states = [
  {
    entity_id: 'light.desk',
    state: 'on',
    attributes: {
      brightness: 179,
      rgb_color: [255, 200, 100],
      supported_color_modes: ['rgb'],
      effect_list: ['rainbow'],
      effect: 'rainbow',
    },
  },
  {
    entity_id: 'light.office_group',
    state: 'on',
    attributes: { entity_id: ['light.desk'], supported_color_modes: ['rgb'] },
  },
  { entity_id: 'light.attic_bulb', state: 'off', attributes: {} },
]

let ha: Awaited<ReturnType<typeof fakeHa>> | null = null
let client: HaClient | null = null

afterEach(async () => {
  client?.close()
  client = null
  await ha?.close()
  ha = null
})

describe('Home Assistant client', () => {
  it('times out one silent request without poisoning the next', async () => {
    const ha = await fakeHa({ areas, states, swallow: ['get_states'] })
    try {
      const client = await createHaClient({ url: ha.url, token: 'good-token', timeoutMs: 50 })
      await expect(client.lights('office')).rejects.toThrow('did not answer get_states')
      // The timed-out slot is gone: the socket still answers the next question.
      await expect(client.areas()).resolves.toHaveLength(2)
      client.close()
    } finally {
      await ha.close()
    }
  })

  it('authenticates and lists areas', async () => {
    ha = await fakeHa({ areas })
    client = await createHaClient({ url: ha.url, token: 'good-token' })
    expect(await client.areas()).toEqual([
      { areaId: 'office', name: 'Office' },
      { areaId: 'attic', name: 'Attic' },
    ])
  })

  it('rejects a token Home Assistant refuses, saying why', async () => {
    ha = await fakeHa({ token: 'the-real-token' })
    await expect(createHaClient({ url: ha.url, token: 'stale' })).rejects.toThrow(/token/i)
  })

  it('lists the lights in an Area, skipping switches and group entities whose members are all there', async () => {
    ha = await fakeHa({ areas, entities, states })
    client = await createHaClient({ url: ha.url, token: 'good-token' })
    const lights = await client.lights('office')
    expect(lights.map((l) => l.entityId)).toEqual(['light.desk'])
    expect(lights[0]).toMatchObject({
      name: 'Desk',
      state: 'on',
      colorModes: ['rgb'],
      effectList: ['rainbow'],
      effect: 'rainbow',
    })
  })

  it('finds a light through the Area of its device', async () => {
    ha = await fakeHa({
      areas,
      entities: [
        {
          entity_id: 'light.tuya',
          area_id: null,
          device_id: 'dev-1',
          disabled_by: null,
          hidden_by: null,
          name: 'Tuya',
        },
      ],
      devices: [{ id: 'dev-1', area_id: 'office' }],
      states: [{ entity_id: 'light.tuya', state: 'on', attributes: { friendly_name: 'Quarto luz' } }],
    })
    client = await createHaClient({ url: ha.url, token: 'good-token' })
    const lights = await client.lights('office')
    expect(lights.map((l) => l.entityId)).toEqual(['light.tuya'])
    expect(lights[0].name).toBe('Quarto luz')
  })

  it('sends one group turn_on with colour, brightness and a transition', async () => {
    ha = await fakeHa({ areas, entities, states })
    client = await createHaClient({ url: ha.url, token: 'good-token' })
    await client.apply(['light.desk'], { rgb: [200, 30, 25], brightnessPct: 60 }, 3)

    const call = ha.calls.find((c) => c.type === 'call_service')
    expect(call).toMatchObject({
      domain: 'light',
      service: 'turn_on',
      target: { entity_id: ['light.desk'] },
      service_data: { rgb_color: [200, 30, 25], brightness_pct: 60, transition: 3 },
    })
  })

  it('reports a change the DM made by hand, and ignores its own writes', async () => {
    ha = await fakeHa({ areas, entities, states })
    client = await createHaClient({ url: ha.url, token: 'good-token' })
    await client.lights('office')

    const seen: string[] = []
    client.onExternalChange((entityId) => seen.push(entityId))

    // One real write, so the client learns a context id of its own.
    await client.apply(['light.desk'], { rgb: [255, 255, 255], brightnessPct: 50 }, 3)
    const ourId = ha.calls.filter((c) => c.id !== undefined).at(-1)!.id as number

    ha.emit({
      event_type: 'state_changed',
      data: { entity_id: 'light.desk', new_state: { entity_id: 'light.desk', state: 'off', context: { id: 'human' } } },
    })
    ha.emit({
      event_type: 'state_changed',
      data: {
        entity_id: 'light.desk',
        new_state: { entity_id: 'light.desk', state: 'on', context: { id: `ours-${ourId}` } },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(seen).toEqual(['light.desk'])
  })

  it('sends an effect and a level without inventing a colour', async () => {
    ha = await fakeHa({ areas, entities, states })
    client = await createHaClient({ url: ha.url, token: 'good-token' })
    await client.apply(['light.desk'], { effect: 'rainbow', brightnessPct: 30 }, 3)

    const call = ha.calls.find((c) => c.type === 'call_service')
    expect(call?.service_data).toEqual({ effect: 'rainbow', brightness_pct: 30, transition: 3 })
  })

  it('sends no colour to a light that cannot take one', async () => {
    ha = await fakeHa({ areas, entities, states })
    client = await createHaClient({ url: ha.url, token: 'good-token' })
    await client.apply(['light.desk'], { brightnessPct: 40 }, 3)

    const call = ha.calls.find((c) => c.type === 'call_service')
    expect(call?.service_data).not.toHaveProperty('rgb_color')
    expect(call?.service_data).toMatchObject({ brightness_pct: 40 })
  })
  it('fails the handshake instead of hanging when nothing answers', async () => {
    const wss = new WebSocketServer({ port: 0 })
    await new Promise<void>((resolve) => wss.on('listening', () => resolve()))
    const port = (wss.address() as { port: number }).port
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.11.0' }))
      // Deliberately never answers the auth frame.
    })
    try {
      await expect(createHaClient({ url: `http://127.0.0.1:${port}`, token: 'any', timeoutMs: 100 })).rejects.toThrow(
        /handshake/,
      )
    } finally {
      for (const client of wss.clients) client.terminate()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    }
  })
})

describe('lan guard', () => {
  it('accepts the addresses a home network uses', () => {
    for (const url of [
      'http://192.168.1.20:8123',
      'http://10.0.0.5:8123',
      'http://172.16.4.4:8123',
      'http://127.0.0.1:8123',
      'http://homeassistant.local:8123',
      'http://homeassistant:8123',
      'http://[::1]:8123',
      'http://100.101.102.103:8123',
      'https://raspberrypi.tail843ac4.ts.net:8124',
    ]) {
      expect(socketUrl(url)).toMatch(/\/api\/websocket$/)
    }
  })

  it('refuses a public address, as ADR-0004 requires', () => {
    expect(isLanHost('example.com')).toBe(false)
    expect(isLanHost('8.8.8.8')).toBe(false)
    expect(isLanHost('100.128.0.1')).toBe(false)
    // `fc`/`fd` are IPv6 prefixes, not hostname prefixes: a DNS name that starts
    // with them must not inherit LAN trust.
    expect(isLanHost('fd.attacker.net')).toBe(false)
    expect(isLanHost('fc.example.com')).toBe(false)
    expect(isLanHost('fd12:3456::1')).toBe(true)
    expect(isLanHost('nas')).toBe(true)
    expect(() => socketUrl('https://ha.example.com')).toThrow(/local network/)
  })
})
