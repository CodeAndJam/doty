import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createSessionStore } from './store'

const at = 1_700_000_000_000

function store() {
  return createSessionStore(new Database(':memory:'))
}

describe('session store', () => {
  it('remembers the session Area and hint, and overwrites on a second write', () => {
    const s = store()
    expect(s.getLights('session-a.vtt')).toBeNull()

    s.setLights({ session: 'session-a.vtt', areaId: 'office', hint: 'dark and funny', pinned: true })
    expect(s.getLights('session-a.vtt')).toEqual({
      session: 'session-a.vtt',
      areaId: 'office',
      hint: 'dark and funny',
      pinned: true,
    })

    s.setLights({ session: 'session-a.vtt', areaId: 'attic', hint: '', pinned: false })
    expect(s.getLights('session-a.vtt')).toMatchObject({ areaId: 'attic', pinned: false })
  })

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

  it('keeps light decisions out of the music KPI', () => {
    const s = store()
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
      kind: 'light',
      action: 'pause',
      reason: 'the DM took the light',
      track: null,
      probability: 0,
      mood: 'tavern',
      source: 'manual',
    })

    expect(s.report(at)).toMatchObject({ decisions: 1, autoActions: 1, manualPicks: 0, overrideRate: 0 })
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

  it('keeps a text and an audio vector for the same track', () => {
    // The two indexers both write the same path. With `path` as the primary key
    // they overwrote each other on every launch, which made every pass re-embed
    // the whole library.
    const s = store()
    s.putVector('a.mp3', 'text-model', Float32Array.from([1, 2]))
    s.putVector('a.mp3', 'audio-model', Float32Array.from([3, 4]))
    expect(Array.from(s.getVector('a.mp3', 'text-model') ?? [])).toEqual([1, 2])
    expect(Array.from(s.getVector('a.mp3', 'audio-model') ?? [])).toEqual([3, 4])
  })

  it('migrates the old one-model-per-path table in place', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE track_vectors (
      path TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL,
      vector BLOB NOT NULL, updated_at INTEGER NOT NULL
    )`)
    db.prepare('INSERT INTO track_vectors VALUES (?, ?, ?, ?, ?)').run(
      'a.mp3',
      'text-model',
      1,
      Buffer.from(Float32Array.from([7]).buffer),
      at,
    )
    const s = createSessionStore(db)
    expect(Array.from(s.getVector('a.mp3', 'text-model') ?? [])).toEqual([7])
    s.putVector('a.mp3', 'audio-model', Float32Array.from([8]))
    expect(Array.from(s.getVector('a.mp3', 'audio-model') ?? [])).toEqual([8])
  })
})
