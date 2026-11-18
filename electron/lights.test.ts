import { describe, expect, it } from 'vitest'
import { createLightDirector, type LightPort, type LightState, moodFromHint, presetFor } from './lights'
import type { DecisionRow } from './session/store'

const MINUTE = 60_000

/** What the port saw, in order, so a test asserts behaviour not internals. */
function fakePort(states: LightState[] = []) {
  const applied: Array<{ rgb: [number, number, number]; brightnessPct: number }> = []
  const restored: LightState[][] = []
  const port: LightPort = {
    states: async () => states,
    apply: async (preset) => {
      applied.push(preset)
    },
    applyStates: async (snapshot) => {
      restored.push(snapshot)
    },
  }
  return { port, applied, restored }
}

function rig(options: { states?: LightState[]; start?: number } = {}) {
  let clock = options.start ?? 1_000_000
  const rows: DecisionRow[] = []
  const { port, applied, restored } = fakePort(options.states)
  const director = createLightDirector(port, {
    now: () => clock,
    record: (row) => rows.push(row),
  })
  return {
    director,
    rows,
    applied,
    restored,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe('presetFor', () => {
  it('paints combat deep red, dim at zero intensity', () => {
    expect(presetFor('combat', 0)).toEqual({ rgb: [200, 30, 25], brightnessPct: 20 })
  })

  it('scales brightness with intensity, clamped', () => {
    expect(presetFor('exploration', 1).brightnessPct).toBe(100)
    expect(presetFor('exploration', 0.5).brightnessPct).toBe(60)
    expect(presetFor('exploration', 4).brightnessPct).toBe(100)
    expect(presetFor('exploration', -1).brightnessPct).toBe(20)
  })

  it('falls back to exploration for a mood it does not know', () => {
    expect(presetFor('nonsense', 0.5)).toEqual(presetFor('exploration', 0.5))
  })
})

describe('moodFromHint', () => {
  it('reads a mood out of the DM’s words, in English or Portuguese', () => {
    expect(moodFromHint('we enter the feywild, like Avatar')).toBe('exploration')
    expect(moodFromHint('a fight breaks out')).toBe('combat')
    expect(moodFromHint('voltamos à taberna')).toBe('tavern')
  })

  it('names no mood when the words are not about one', () => {
    expect(moodFromHint('07')).toBeNull()
    expect(moodFromHint('')).toBeNull()
  })
})

describe('light director', () => {
  it('applies a preset once per mood and logs the row', async () => {
    const { director, applied, rows } = rig()
    await director.observe({ mood: 'tavern', intensity: 0.5, probability: 0.8, producer: 'mood' })
    await director.observe({ mood: 'tavern', intensity: 0.5, probability: 0.8, producer: 'mood' })

    expect(applied).toHaveLength(1)
    expect(applied[0]).toEqual(presetFor('tavern', 0.5))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'light', action: 'tavern', mood: 'tavern', source: 'auto' })
  })

  it('waits for the dwell before a new mood reaches the lights', async () => {
    const { director, applied, advance } = rig()
    await director.observe({ mood: 'tavern', intensity: 0.5, probability: 0.8, producer: 'mood' })
    advance(10_000)
    await director.observe({ mood: 'combat', intensity: 0.9, probability: 0.9, producer: 'mood' })
    expect(applied).toHaveLength(1)

    advance(16_000)
    await director.observe({ mood: 'combat', intensity: 0.9, probability: 0.9, producer: 'mood' })
    expect(applied[1]).toEqual(presetFor('combat', 0.9))
  })

  it('holds the light when the DM takes it, for fifteen minutes after their last touch', async () => {
    const { director, applied, advance } = rig()
    await director.observe({ mood: 'tavern', intensity: 0.5, probability: 0.8, producer: 'mood' })

    advance(30_000)
    director.noteManualChange()
    expect(director.state().paused).toBe(true)

    advance(14 * MINUTE)
    director.noteManualChange()
    advance(14 * MINUTE)
    await director.observe({ mood: 'combat', intensity: 0.9, probability: 0.9, producer: 'mood' })
    expect(applied).toHaveLength(1)

    advance(MINUTE + 1)
    await director.observe({ mood: 'combat', intensity: 0.9, probability: 0.9, producer: 'mood' })
    expect(applied[1]).toEqual(presetFor('combat', 0.9))
  })

  it('resumes immediately when the DM asks, and logs both ends', async () => {
    const { director, applied, rows } = rig()
    director.noteManualChange()
    director.resume()
    expect(director.state().paused).toBe(false)

    await director.observe({ mood: 'mystery', intensity: 0.4, probability: 0.7, producer: 'mood' })
    expect(applied).toHaveLength(1)
    expect(rows.map((r) => r.action)).toEqual(['pause', 'resume', 'mystery'])
  })

  it('restores what it found when Doty wrote last', async () => {
    const snapshot: LightState[] = [{ entityId: 'light.office', on: true, brightnessPct: 70 }]
    const { director, restored, advance } = rig({ states: snapshot })
    await director.startSession()
    advance(1000)
    await director.observe({ mood: 'combat', intensity: 1, probability: 0.9, producer: 'mood' })

    await director.endSession()
    expect(restored).toEqual([snapshot])
  })

  it('leaves the room alone when the DM touched the light after Doty', async () => {
    const { director, restored, advance } = rig({ states: [{ entityId: 'light.office', on: false }] })
    await director.startSession()
    await director.observe({ mood: 'combat', intensity: 1, probability: 0.9, producer: 'mood' })
    advance(1000)
    director.noteManualChange()

    await director.endSession()
    expect(restored).toEqual([])
  })

  it('does not restore a session that never changed anything', async () => {
    const { director, restored } = rig({ states: [{ entityId: 'light.office', on: true }] })
    await director.startSession()
    await director.endSession()
    expect(restored).toEqual([])
  })

  it('reports who produced the current preset', async () => {
    const { director, rows } = rig()
    await director.observe({ mood: 'voyage', intensity: 0.5, probability: 0.6, producer: 'hint' })
    expect(director.state()).toMatchObject({ mood: 'voyage', producer: 'hint' })
    // ADR-0005: the log says hint, so the KPI can tell the DM's words from the model's.
    expect(rows[0]).toMatchObject({ source: 'hint', reason: 'hint' })
  })
})
