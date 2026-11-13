/**
 * Session memory: what the scene was, what was decided and why, and what the
 * DM chose over the model.
 *
 * Takes a Database handle rather than reaching for the app's singleton, so the
 * whole thing runs against an in-memory SQLite in tests. The schema is created
 * here because these tables belong to the session loop, not to the library.
 */

export interface SceneRow {
  session: string
  mood: string
  intensity: number
  startedAt: number
}

export interface DecisionRow {
  at: number
  kind: string
  action: string
  reason: string
  track: string | null
  probability: number
  mood: string | null
  source: 'auto' | 'manual'
}

export interface PreferenceRow {
  at: number
  /** The transcript that produced the choice. */
  segment: string
  track: string
  scene: string | null
  source: 'auto' | 'manual'
}

export interface SessionReport {
  decisions: number
  autoActions: number
  manualPicks: number
  /** Share of acted-on suggestions the DM replaced. The KPI from AGENTS.md. */
  overrideRate: number
}

interface Db {
  exec(sql: string): unknown
  prepare(sql: string): {
    run(...args: never[]): unknown
    all(...args: never[]): unknown[]
    get(...args: never[]): unknown
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS session_scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session TEXT NOT NULL,
  mood TEXT NOT NULL,
  intensity REAL NOT NULL,
  started_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS session_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  track TEXT,
  probability REAL NOT NULL,
  mood TEXT,
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_decisions_at ON session_decisions (at);
CREATE TABLE IF NOT EXISTS session_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  segment TEXT NOT NULL,
  track TEXT NOT NULL,
  scene TEXT,
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_preferences_at ON session_preferences (at);
CREATE TABLE IF NOT EXISTS track_vectors (
  path TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
`

export interface SessionStore {
  recordScene(row: SceneRow): void
  recordDecision(row: DecisionRow): void
  recordPreference(row: PreferenceRow): void
  recentPreferences(limit: number): PreferenceRow[]
  report(since: number): SessionReport
  /** Stored embeddings, for retrieval once the embedder is installed. */
  putVector(path: string, model: string, vector: Float32Array): void
  getVector(path: string, model: string): Float32Array | null
}

export function createSessionStore(db: Db): SessionStore {
  db.exec(SCHEMA)

  const insertScene = db.prepare(
    'INSERT INTO session_scenes (session, mood, intensity, started_at) VALUES (?, ?, ?, ?)',
  )
  const insertDecision = db.prepare(
    'INSERT INTO session_decisions (at, kind, action, reason, track, probability, mood, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const insertPreference = db.prepare(
    'INSERT INTO session_preferences (at, segment, track, scene, source) VALUES (?, ?, ?, ?, ?)',
  )
  const selectPreferences = db.prepare(
    'SELECT at, segment, track, scene, source FROM session_preferences ORDER BY at DESC LIMIT ?',
  )
  const selectReport = db.prepare(
    `SELECT
       COUNT(*) AS decisions,
       SUM(CASE WHEN source = 'auto' AND action != 'hold' THEN 1 ELSE 0 END) AS autoActions,
       SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END) AS manualPicks
     FROM session_decisions WHERE at >= ?`,
  )
  const upsertVector = db.prepare(
    `INSERT INTO track_vectors (path, model, dim, vector, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET model = excluded.model, dim = excluded.dim,
       vector = excluded.vector, updated_at = excluded.updated_at`,
  )
  const selectVector = db.prepare('SELECT dim, vector FROM track_vectors WHERE path = ? AND model = ?')

  return {
    recordScene(row) {
      insertScene.run(row.session as never, row.mood as never, row.intensity as never, row.startedAt as never)
    },
    recordDecision(row) {
      insertDecision.run(
        row.at as never,
        row.kind as never,
        row.action as never,
        row.reason as never,
        row.track as never,
        row.probability as never,
        row.mood as never,
        row.source as never,
      )
    },
    recordPreference(row) {
      insertPreference.run(
        row.at as never,
        row.segment as never,
        row.track as never,
        row.scene as never,
        row.source as never,
      )
    },
    recentPreferences(limit) {
      return selectPreferences.all(limit as never) as PreferenceRow[]
    },
    report(since) {
      const row = selectReport.get(since as never) as { decisions: number; autoActions: number; manualPicks: number }
      const manual = row.manualPicks ?? 0
      const auto = row.autoActions ?? 0
      const acted = manual + auto
      return {
        decisions: row.decisions ?? 0,
        autoActions: auto,
        manualPicks: manual,
        overrideRate: acted === 0 ? 0 : manual / acted,
      }
    },
    putVector(path, model, vector) {
      const bytes = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
      upsertVector.run(path as never, model as never, vector.length as never, bytes as never, Date.now() as never)
    },
    getVector(path, model) {
      const row = selectVector.get(path as never, model as never) as { dim: number; vector: Buffer } | undefined
      if (!row) return null
      const copy = new Float32Array(row.vector.byteLength / 4)
      Buffer.from(row.vector).copy(Buffer.from(copy.buffer))
      return copy
    },
  }
}
