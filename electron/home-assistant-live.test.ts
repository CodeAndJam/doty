/**
 * Live check against a real Home Assistant on the DM's network.
 *
 * Off by default: it reads and writes actual lights, so it runs only when the
 * operator asks for it (`HA_LIVE=1`) with an address and a token in the
 * environment. Restores whatever it found, in a `finally`.
 *
 *   HA_LIVE=1 \
 *   HA_URL=https://homeassistant.local:8123 \
 *   HA_TOKEN=... \
 *   npx vitest run electron/home-assistant-integration.test.ts
 *
 * `HA_AREA` picks the room (name or id); it defaults to an Area matching
 * /office/i.
 *
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from 'vitest'
import { createHaClient, type HaClient, type HaLight } from './home-assistant'
import { createLighting } from './lighting'

const url = process.env.HA_URL ?? ''
const token = process.env.HA_TOKEN ?? ''
const wantArea = process.env.HA_AREA ?? 'office'

let client: HaClient | null = null
afterAll(() => client?.close())

/** Re-read until the predicate holds, or the deadline passes. */
async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (ok(value) || Date.now() > deadline) return value
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

describe.skipIf(!url || !token)('live Home Assistant', () => {
  it('finds the Area, lists its lights, writes one and puts it back', async () => {
    client = await createHaClient({ url, token })

    const areas = await client.areas()
    console.log(
      '[live] areas:',
      areas.map((a) => `${a.name} (${a.areaId})`),
    )
    const area = areas.find((entry) => entry.name.toLowerCase() === wantArea.toLowerCase() || entry.areaId === wantArea)
    expect(area, `no Area named ${wantArea}; saw: ${areas.map((a) => a.name).join(', ')}`).toBeDefined()

    const lights = await client.lights(area!.areaId)
    console.log(
      '[live] lights:',
      lights.map(
        (l) =>
          `${l.name} (${l.entityId}) on=${l.state} brightness=${l.brightnessPct ?? '-'} modes=${l.colorModes} effects=${l.effectList}`,
      ),
    )
    expect(lights.length).toBeGreaterThan(0)

    const lamp: HaLight = lights[0]
    const restore = () =>
      lamp.state === 'off'
        ? client!.turnOff([lamp.entityId], 0)
        : client!.apply([lamp.entityId], { brightnessPct: lamp.brightnessPct, rgb: lamp.rgb }, 0)

    try {
      const target = lamp.brightnessPct === 42 ? 43 : 42
      await client.apply([lamp.entityId], { brightnessPct: target }, 0)
      // Home Assistant acknowledges a service call before the device reports
      // its new state, so give the integration a moment to catch up.
      const after = await until(
        async () => (await client!.lights(area!.areaId)).find((l) => l.entityId === lamp.entityId),
        (found) => found?.brightnessPct === target,
        4000,
      )
      expect(after?.brightnessPct, 'the light did not take the level').toBe(target)
    } finally {
      await restore()
    }

    // Whatever was written must echo back as ours, not as a DM's hand.
    const seen: string[] = []
    client.onExternalChange((entityId) => seen.push(entityId))
    await client.apply([lamp.entityId], { brightnessPct: lamp.brightnessPct ?? 50 }, 0)
    await new Promise((resolve) => setTimeout(resolve, 300))
    await restore()
    expect(seen, 'Doty heard its own write as a manual change').toEqual([])
  })

  it('breathes a lamp that has no effects of its own', async () => {
    const settings = new Map<string, string>([
      ['lightUrl', url],
      ['lightArea', 'office'],
    ])
    const lighting = createLighting({
      getSetting: (key, fallback) => settings.get(key) ?? fallback,
      setSetting: (key, value) => settings.set(key, String(value)),
      saveToken: async () => {},
      loadToken: async () => token,
      clearToken: () => {},
      connect: (address, accessToken) => createHaClient({ url: address, token: accessToken }),
      sessionStore: {
        getLights: () => null,
        setLights: () => {},
        recordDecision: () => {},
      },
      now: () => Date.now(),
      emit: () => {},
    })
    const probe = await createHaClient({ url, token })

    await lighting.state(null)
    const areaId = lighting.current().areaId
    const lamp = (await probe.lights(areaId))[0]
    const before = { brightnessPct: lamp.brightnessPct, rgb: lamp.rgb }

    try {
      await lighting.setPulse(true)
      expect(lighting.current().pulse).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await lighting.setPulse(false)
      expect(lighting.current().pulse).toBe(false)

      // Read while the breath is fresh: a lamp ignoring the stream would still
      // sit at the pre-pulse level.
      const after = (await probe.lights(areaId))[0]
      expect(after.brightnessPct).toBeGreaterThanOrEqual(20)
      expect(after.brightnessPct).toBeLessThanOrEqual(75)
    } finally {
      if (before.rgb) {
        await probe.apply([lamp.entityId], { rgb: before.rgb, brightnessPct: before.brightnessPct ?? 50 }, 0)
      }
      probe.close()
    }
  })
})
