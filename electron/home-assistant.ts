/**
 * Home Assistant over its WebSocket API, and nothing else.
 *
 * One socket does everything the feature needs: the registries say which lights
 * exist and which Area they are in, `state_changed` says when the DM takes the
 * light back, and `call_service` writes. REST is not used — it cannot see Areas,
 * and a second auth path is a second thing to break.
 *
 * The client is deliberately dumb about policy: it reports changes and executes
 * commands. `lights.ts` decides what to write and when.
 */
import { isIP } from 'node:net'
import WebSocket from 'ws'
import type { LightState, Rgb } from './lights'

export interface HaArea {
  areaId: string
  name: string
}

export interface HaLight {
  entityId: string
  name: string
  state: 'on' | 'off'
  brightnessPct?: number
  rgb?: Rgb
  colorModes: string[]
  /** Animations the light advertises, e.g. WLED or Hue scenes. */
  effectList: string[]
  effect: string | null
}

/** A light set that cannot take a colour: brightness is all it understands. */
export interface ApplyData {
  rgb?: Rgb
  brightnessPct?: number
  /** `light.turn_on`'s `effect`, for lights that advertise a list. */
  effect?: string
}

export interface HaClient {
  areas(): Promise<HaArea[]>
  lights(areaId: string): Promise<HaLight[]>
  apply(entityIds: string[], preset: ApplyData, transitionSec: number): Promise<void>
  turnOff(entityIds: string[], transitionSec: number): Promise<void>
  /** Apply raw states, for putting the room back the way it was found. */
  applyStates(states: LightState[]): Promise<void>
  onExternalChange(listener: (entityId: string) => void): () => void
  onClose(listener: () => void): () => void
  close(): void
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type WsMessage = {
  id?: number
  type?: string
  success?: boolean
  result?: unknown
  error?: { message?: string }
  event?: { event_type?: string; data?: { entity_id?: string; new_state?: { context?: { id?: string } } } }
}

const REQUEST_TIMEOUT_MS = 10_000

/** RFC 1918, loopback, IPv6 local, and Tailscale's CGNAT range. */
const PRIVATE_IPV4 = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/
const PRIVATE_IPV6 = /^(::1|fe80:|f[cd])/i

/**
 * ADR-0004: Home Assistant on the DM's own network, never a public address. A
 * hostname qualifies when it is link-local (`.local`), a Tailscale MagicDNS
 * name (the DM's private tailnet, not a public relay), or a bare mDNS name.
 */
export function isLanHost(host: string): boolean {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (bare.length === 0) return false
  if (bare === 'localhost' || bare.endsWith('.local') || bare.endsWith('.ts.net')) return true
  const kind = isIP(bare)
  if (kind === 4) return PRIVATE_IPV4.test(bare)
  if (kind === 6) return PRIVATE_IPV6.test(bare)
  // A single-label hostname (`nas`, `homeassistant`) is a LAN name; anything with
  // a dot is a DNS name and must not match `fc`/`fd` by prefix.
  return !bare.includes('.') && !bare.includes(':')
}

export function socketUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  const base = /^wss?:\/\//.test(trimmed) ? trimmed : trimmed.replace(/^http/, 'ws')
  let host: string
  try {
    host = new URL(base).hostname
  } catch {
    throw new Error(`${url} is not a Home Assistant address`)
  }
  if (!isLanHost(host)) throw new Error(`${host} is not on the local network`)
  return `${base}/api/websocket`
}

function brightnessPct(brightness: unknown): number | undefined {
  return typeof brightness === 'number' ? Math.round((brightness / 255) * 100) : undefined
}

export async function createHaClient(options: {
  url: string
  token: string
  /** Overridden by tests; production waits ten seconds. */
  timeoutMs?: number
}): Promise<HaClient> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const socket = new WebSocket(socketUrl(options.url))
  const pending = new Map<number, Pending>()
  const ownContexts = new Set<string>()
  const changeListeners = new Set<(entityId: string) => void>()
  const closeListeners = new Set<() => void>()
  let nextId = 1
  let closed = false

  const fail = (message: string) => {
    closed = true
    for (const p of pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error(message))
    }
    pending.clear()
  }

  socket.on('close', () => {
    fail('Home Assistant connection closed')
    for (const listener of closeListeners) listener()
  })
  socket.on('error', () => fail('Home Assistant unreachable'))

  function request<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (closed) return Promise.reject(new Error('Home Assistant connection closed'))
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Home Assistant did not answer ${type}`))
      }, timeoutMs)
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      socket.send(JSON.stringify({ id, type, ...payload }))
    })
  }

  function callService(service: 'turn_on' | 'turn_off', entityIds: string[], data: Record<string, unknown>) {
    return request<{ context?: { id?: string } }>('call_service', {
      domain: 'light',
      service,
      target: { entity_id: entityIds },
      service_data: data,
    }).then((result) => {
      const context = result?.context?.id
      if (context) ownContexts.add(context)
    })
  }

  await new Promise<void>((resolve, reject) => {
    // Without a deadline a proxy that accepts the socket and never forwards the
    // handshake leaves the panel stuck on "connecting" forever.
    const timer = setTimeout(() => {
      socket.off('message', onMessage)
      reject(new Error('Home Assistant did not answer the handshake'))
    }, timeoutMs)

    const fail = (message: string) => {
      clearTimeout(timer)
      socket.off('message', onMessage)
      reject(new Error(message))
    }
    socket.once('error', () => fail('Home Assistant unreachable'))
    socket.once('close', () => fail('Home Assistant closed the connection'))

    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as WsMessage
      if (message.type === 'auth_required') {
        socket.send(JSON.stringify({ type: 'auth', access_token: options.token }))
        return
      }
      if (message.type === 'auth_invalid') {
        fail(message.error?.message ?? 'Home Assistant refused the access token')
        return
      }
      if (message.type === 'auth_ok') {
        clearTimeout(timer)
        socket.off('message', onMessage)
        socket.on('message', handleMessage)
        resolve()
        return
      }
    }

    const handleMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as WsMessage
      if (message.id !== undefined && pending.has(message.id)) {
        const entry = pending.get(message.id)!
        pending.delete(message.id)
        clearTimeout(entry.timer)
        if (message.success) entry.resolve(message.result)
        else entry.reject(new Error(message.error?.message ?? 'Home Assistant rejected the request'))
        return
      }
      if (message.type === 'event' && message.event?.event_type === 'state_changed') {
        const data = message.event.data
        const entityId = data?.entity_id
        const context = data?.new_state?.context?.id
        if (!entityId?.startsWith('light.')) return
        // A change carrying our own context id is Doty's write echoing back; a
        // DM at the wall switch has no context id we know.
        if (context && ownContexts.has(context)) return
        for (const listener of changeListeners) listener(entityId)
      }
    }

    socket.on('message', onMessage)
  })

  await request('subscribe_events', { event_type: 'state_changed' })

  const client: HaClient = {
    async areas() {
      const rows = await request<Array<{ area_id: string; name: string }>>('config/area_registry/list')
      return (rows ?? []).map((row) => ({ areaId: row.area_id, name: row.name }))
    },

    async lights(areaId) {
      const [registry, devices, states] = await Promise.all([
        request<
          Array<{
            entity_id: string
            area_id: string | null
            device_id: string | null
            disabled_by: string | null
            hidden_by: string | null
          }>
        >('config/entity_registry/list'),
        request<Array<{ id: string; area_id: string | null }>>('config/device_registry/list'),
        request<Array<{ entity_id: string; state: string; attributes: Record<string, unknown> }>>('get_states'),
      ])
      const byId = new Map((states ?? []).map((s) => [s.entity_id, s]))
      const deviceArea = new Map((devices ?? []).map((device) => [device.id, device.area_id]))
      // An entity often has no Area of its own: it inherits the Area of its
      // device. A Tuya lamp is exactly this — the registry says `area_id: null`.
      const areaOf = (row: { area_id: string | null; device_id: string | null }) =>
        row.area_id ?? (row.device_id ? (deviceArea.get(row.device_id) ?? null) : null)
      const inArea = (registry ?? []).filter(
        (row) => row.entity_id.startsWith('light.') && areaOf(row) === areaId && !row.disabled_by && !row.hidden_by,
      )
      const areaIds = new Set(inArea.map((row) => row.entity_id))

      return inArea
        .filter((row) => {
          // A group is redundant when every member is already here: commanding
          // both would apply the same transition twice.
          const members = byId.get(row.entity_id)?.attributes.entity_id
          return !(Array.isArray(members) && members.length > 0 && members.every((m) => areaIds.has(String(m))))
        })
        .map((row) => {
          const state = byId.get(row.entity_id)
          const attributes = state?.attributes ?? {}
          const rgb = attributes.rgb_color as Rgb | undefined
          return {
            entityId: row.entity_id,
            name:
              (attributes.friendly_name as string | undefined) ??
              (row as { name?: string | null }).name ??
              row.entity_id,
            state: state?.state === 'on' ? ('on' as const) : ('off' as const),
            brightnessPct: brightnessPct(attributes.brightness),
            rgb: Array.isArray(rgb) ? ([...rgb] as Rgb) : undefined,
            colorModes: (attributes.supported_color_modes as string[] | undefined) ?? [],
            effectList: (attributes.effect_list as string[] | undefined) ?? [],
            effect: (attributes.effect as string | undefined) ?? null,
          }
        })
    },

    async apply(entityIds, preset, transitionSec) {
      await callService('turn_on', entityIds, {
        // A light that advertises no colour mode rejects rgb_color outright.
        ...(preset.rgb ? { rgb_color: preset.rgb } : {}),
        ...(preset.brightnessPct !== undefined ? { brightness_pct: preset.brightnessPct } : {}),
        ...(preset.effect !== undefined ? { effect: preset.effect } : {}),
        transition: transitionSec,
      })
    },

    async turnOff(entityIds, transitionSec) {
      await callService('turn_off', entityIds, { transition: transitionSec })
    },

    async applyStates(states) {
      if (states.length === 0) return
      const off = states.filter((s) => !s.on).map((s) => s.entityId)
      if (off.length > 0) await callService('turn_off', off, { transition: 3 })
      const groups = new Map<string, { data: Record<string, unknown>; ids: string[] }>()
      for (const state of states.filter((s) => s.on)) {
        const data: Record<string, unknown> = { transition: 3 }
        if (state.brightnessPct !== undefined) data.brightness_pct = state.brightnessPct
        if (state.rgb) data.rgb_color = state.rgb
        const key = JSON.stringify(data)
        const group = groups.get(key) ?? { data, ids: [] }
        group.ids.push(state.entityId)
        groups.set(key, group)
      }
      for (const group of groups.values()) await callService('turn_on', group.ids, group.data)
    },

    onExternalChange(listener) {
      changeListeners.add(listener)
      return () => changeListeners.delete(listener)
    },

    onClose(listener) {
      closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },

    close() {
      closed = true
      fail('Home Assistant client closed')
      socket.close()
    },
  }

  return client
}
