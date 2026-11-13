import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createSessionStore } from './store'

const at = 1_700_000_000_000

function store() {
  return createSessionStore(new Database(':memory:'))
}

describe('session store', () => {
  it('records decisions in order and reads them back by time', () => {
    const s = store()
    s.recordDecision({
      at,
      kind: 'music',
      action: 'hold',
      reason: 'scene unchanged',
      track: 'a.mp3',
      probability: 0.4,
      mood: 'peaceful',
      source: 'auto',
    })
    s.recordDecision({
      at: at + 1,
      kind: 'music',
      action: 'queue-next',
      reason: 'boundary',
      track: 'b.mp3',
      probability: 0.6,
      mood: 'peaceful',
      source: 'auto',
    })
    expect(s.report(at).decisions).toBe(2)
    expect(s.report(at).autoActions).toBe(1)
  })

  it('computes the override rate: manual picks over everything acted on', () => {
    const s = store()
    // two automatic switches, one manual pick → the DM replaced a third
    s.recordDecision({
      at,
      kind: 'music',
      action: 'queue-next',
      reason: '',
      track: null,
      probability: 0.6,
      mood: null,
      source: 'auto',
    })
    s.recordDecision({
      at,
      kind: 'music',
      action: 'play-now',
      reason: '',
      track: null,
      probability: 0.95,
      mood: null,
      source: 'auto',
    })
    s.recordDecision({
      at,
      kind: 'music',
      action: 'play-now',
      reason: '',
      track: null,
      probability: 0,
      mood: null,
      source: 'manual',
    })
    expect(s.report(at).overrideRate).toBeCloseTo(1 / 3, 6)
  })

  it('counts holds as decisions but not as actions', () => {
    const s = store()
    for (let i = 0; i < 5; i++) {
      s.recordDecision({
        at,
        kind: 'music',
        action: 'hold',
        reason: '',
        track: null,
        probability: 0.1,
        mood: null,
        source: 'auto',
      })
    }
    expect(s.report(at).decisions).toBe(5)
    expect(s.report(at).autoActions).toBe(0)
    expect(s.report(at).overrideRate).toBe(0)
  })

  it('keeps preferences newest first', () => {
    const s = store()
    s.recordPreference({ at, segment: 'dragon', track: 'a.mp3', scene: 'combat', source: 'manual' })
    s.recordPreference({ at: at + 10, segment: 'tavern', track: 'b.mp3', scene: 'tavern', source: 'manual' })
    expect(s.recentPreferences(5).map((p) => p.track)).toEqual(['b.mp3', 'a.mp3'])
  })

  it('round-trips an embedding without losing precision', () => {
    const s = store()
    const vector = Float32Array.from([0.1, -0.25, 0.3333333, 1])
    s.putVector('a.mp3', 'embeddinggemma-300m-q4', vector)
    const back = s.getVector('a.mp3', 'embeddinggemma-300m-q4')
    expect(back).not.toBeNull()
    expect(Array.from(back ?? [])).toEqual(Array.from(vector))
  })

  it('returns null for a vector from another model', () => {
    const s = store()
    s.putVector('a.mp3', 'model-a', Float32Array.from([1, 2]))
    expect(s.getVector('a.mp3', 'model-b')).toBeNull()
  })
})
