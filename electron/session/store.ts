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
  source: 'auto' | 'manual' | 'hint'
}

export interface PreferenceRow {
  at: number
  /** The transcript that produced the choice. */
  segment: string
  track: string
  scene: string | null
  source: 'auto' | 'manual' | 'reject'
}

export interface SessionReport {
  decisions: number
  autoActions: number
  manualPicks: number
  /** Share of acted-on suggestions the DM replaced. The KPI from AGENTS.md. */
  overrideRate: number
  /**
   * Share of automatic changes the DM did not skip within 30 s, or null when
   * nothing was acted on. "Keeps playing" is the goal, not "picked correctly".
   */
  autoChangeRetention: number | null
  /** Distance from the session start to the DM's first own pick, or null. */
  timeToFirstManualPickMs: number | null
}

/** Where a session plays, and the DM's words about it. */
export interface SessionLightsRow {
  session: string
  areaId: string
  hint: string
  pinned: boolean
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
CREATE TABLE IF NOT EXISTS session_lights (
  session TEXT PRIMARY KEY,
  area TEXT NOT NULL,
  hint TEXT NOT NULL,
  pinned INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS track_vectors (
  path TEXT NOT NULL,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (path, model)
);
`

/**
 * A path now holds one vector per model: the text indexer and the audio indexer
 * both write the same track, and the old `path` primary key made them overwrite
 * each other on every launch. Rebuild the table once; the rows are recomputable,
 * but keep them so a migration does not force a full re-index.
 */
function migrateVectorKey(db: Database.Database): void {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'track_vectors'").get() as
    | { sql?: string }
    | undefined
  if (!table?.sql || /primary key\s*\(\s*path\s*,\s*model\s*\)/i.test(table.sql)) return
  db.exec(`
    ALTER TABLE track_vectors RENAME TO track_vectors_old;
    CREATE TABLE track_vectors (
      path TEXT NOT NULL,
      model TEXT NOT NULL,
      dim INTEGER NOT NULL,
      vector BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (path, model)
    );
    INSERT OR REPLACE INTO track_vectors (path, model, dim, vector, updated_at)
      SELECT path, model, dim, vector, updated_at FROM track_vectors_old;
    DROP TABLE track_vectors_old;
  `)
}

export interface SessionStore {
  recordScene(row: SceneRow): void
  recordDecision(row: DecisionRow): void
  recordPreference(row: PreferenceRow): void
  recentPreferences(limit: number): PreferenceRow[]
  getLights(session: string): SessionLightsRow | null
  setLights(row: SessionLightsRow): void
  report(since: number): SessionReport
  /** Stored embeddings, for retrieval once the embedder is installed. */
  putVector(path: string, model: string, vector: Float32Array): void
  getVector(path: string, model: string): Float32Array | null
}

export function createSessionStore(db: Database.Database): SessionStore {
  db.exec(SCHEMA)
  migrateVectorKey(db)

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
  // Music rows only: a light decision is not a track the DM overrode, and
  // counting it would move the KPI AGENTS.md measures the product by.
  //
  // Retention looks at the rejection that follows an automatic pick: a skip is
  // recorded against the track that was skipped, so a match inside the 30 s
  // window is the DM saying "not this". A rejection of the same track later (a
  // second play, another scene) is not evidence against this choice.
  const selectReport = db.prepare(
    `SELECT
       COUNT(*) AS decisions,
       SUM(CASE WHEN source = 'auto' AND action != 'hold' THEN 1 ELSE 0 END) AS autoActions,
       SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END) AS manualPicks,
       SUM(CASE WHEN source = 'auto' AND action != 'hold'
         AND EXISTS (
           SELECT 1 FROM session_preferences p
           WHERE p.source = 'reject' AND p.track = session_decisions.track
             AND p.at >= session_decisions.at AND p.at <= session_decisions.at + 30000
         ) THEN 1 ELSE 0 END) AS skippedWithin30s,
       (SELECT MIN(at) FROM session_preferences WHERE at >= ? AND source = 'manual') AS firstManualAt
     FROM session_decisions WHERE at >= ? AND kind = 'music'`,
  )
  const selectLights = db.prepare('SELECT session, area, hint, pinned FROM session_lights WHERE session = ?')
  const upsertLights = db.prepare(
    `INSERT INTO session_lights (session, area, hint, pinned) VALUES (?, ?, ?, ?)
     ON CONFLICT(session) DO UPDATE SET area = excluded.area, hint = excluded.hint, pinned = excluded.pinned`,
  )
  const upsertVector = db.prepare(
    `INSERT INTO track_vectors (path, model, dim, vector, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(path, model) DO UPDATE SET dim = excluded.dim,
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
    getLights(session) {
      const row = selectLights.get(session) as
        | { session: string; area: string; hint: string; pinned: number }
        | undefined
      return row ? { session: row.session, areaId: row.area, hint: row.hint, pinned: row.pinned === 1 } : null
    },
    setLights(row) {
      upsertLights.run(row.session, row.areaId, row.hint, row.pinned ? 1 : 0)
    },
    report(since) {
      const row = selectReport.get(since, since) as {
        decisions: number
        autoActions: number
        manualPicks: number
        skippedWithin30s: number | null
        firstManualAt: number | null
      }
      const manual = row.manualPicks ?? 0
      const auto = row.autoActions ?? 0
      const acted = manual + auto
      const skipped = row.skippedWithin30s ?? 0
      return {
        decisions: row.decisions ?? 0,
        autoActions: auto,
        manualPicks: manual,
        overrideRate: acted === 0 ? 0 : manual / acted,
        autoChangeRetention: auto === 0 ? null : 1 - skipped / auto,
        timeToFirstManualPickMs: row.firstManualAt == null ? null : row.firstManualAt - since,
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
