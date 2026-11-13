import type Database from 'better-sqlite3'

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

export function createSessionStore(db: Database.Database): SessionStore {
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
      insertScene.run(row.session, row.mood, row.intensity, row.startedAt)
    },
    recordDecision(row) {
      insertDecision.run(row.at, row.kind, row.action, row.reason, row.track, row.probability, row.mood, row.source)
    },
    recordPreference(row) {
      insertPreference.run(row.at, row.segment, row.track, row.scene, row.source)
    },
    recentPreferences(limit) {
      return selectPreferences.all(limit) as PreferenceRow[]
    },
    report(since) {
      const row = selectReport.get(since) as { decisions: number; autoActions: number; manualPicks: number }
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
      upsertVector.run(path, model, vector.length, bytes, Date.now())
    },
    getVector(path, model) {
      const row = selectVector.get(path, model) as { dim: number; vector: Buffer } | undefined
      if (!row) return null
      const copy = new Float32Array(row.vector.byteLength / 4)
      Buffer.from(row.vector).copy(Buffer.from(copy.buffer))
      return copy
    },
  }
}
