import { join } from 'node:path'
import Database from 'better-sqlite3'
import { DOTY_HOME } from './profile'

const DB_PATH = join(DOTY_HOME, 'doty.db')

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const fs = require('node:fs')
  fs.mkdirSync(join(DB_PATH, '..'), { recursive: true })

  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      path        TEXT PRIMARY KEY,
      title       TEXT,
      artist      TEXT,
      album       TEXT,
      genre       TEXT,
      year        INTEGER,
      track_no    INTEGER,
      duration    REAL,
      bpm         REAL,
      bpm_confidence REAL,
      key         TEXT,
      scale       TEXT,
      danceability REAL,
      energy      REAL,
      loudness    REAL,
      analysis_version INTEGER DEFAULT 0,
      bitrate     INTEGER,
      sample_rate INTEGER,
      channels    INTEGER,
      codec       TEXT,
      mtime       REAL,
      scanned_at  TEXT DEFAULT (datetime('now'))
    )
  `)

  // Columns added after the first release: CREATE TABLE IF NOT EXISTS will not
  // touch an existing database, so add them here. Default 0 makes the scanner
  // re-analyse rows written by an older analysis.
  const columns = db.prepare('PRAGMA table_info(tracks)').all() as Array<{ name: string }>
  const has = (name: string) => columns.some((column) => column.name === name)
  if (!has('loudness')) db.exec('ALTER TABLE tracks ADD COLUMN loudness REAL')
  if (!has('analysis_version')) db.exec('ALTER TABLE tracks ADD COLUMN analysis_version INTEGER DEFAULT 0')

  db.exec(`
    CREATE TABLE IF NOT EXISTS track_tags (
      filename TEXT NOT NULL,
      tag      TEXT NOT NULL,
      PRIMARY KEY (filename, tag)
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tags_tag ON track_tags(tag)`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS play_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id    TEXT NOT NULL,
      item_type  TEXT NOT NULL CHECK(item_type IN ('music', 'sfx')),
      played_at  TEXT DEFAULT (datetime('now'))
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_play_history_item ON play_history(item_id, item_type)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_play_history_time ON play_history(played_at)`)

  // Effects never enter `tracks`, so their measured duration needs its own row.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sfx_durations (
      path       TEXT PRIMARY KEY,
      duration   REAL NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // The DM's lane labels. Keyed by the item's library key, not by a `tracks`
  // row: effects never enter `tracks`, and a lane must cover both libraries.
  db.exec(`
    CREATE TABLE IF NOT EXISTS lane_overrides (
      path       TEXT PRIMARY KEY,
      lane       TEXT NOT NULL CHECK(lane IN ('music', 'sfx')),
      updated_at INTEGER NOT NULL
    )
  `)

  return db
}

// ── Tag queries ───────────────────────────────────────────────────────────────

/**
 * Forget tracks that are no longer under the library folder. Library folders
 * move, files get deleted, and a stale row still competes for a candidate slot
 * with a name that can never be played.
 */
export function pruneMissingTracks(folder: string, files: string[]): number {
  const db = getDb()
  const keep = new Set(files.map((f) => f.replace(/\\/g, '/')))
  const rows = db.prepare('SELECT path FROM tracks').all() as Array<{ path: string }>
  const drop = rows.map((r) => r.path).filter((p) => !keep.has(p.replace(/\\/g, '/')))
  if (drop.length === 0) return 0
  const del = db.prepare('DELETE FROM tracks WHERE path = ?')
  const delTags = db.prepare('DELETE FROM track_tags WHERE filename = ?')
  db.transaction(() => {
    for (const path of drop) {
      del.run(path)
      delTags.run(path)
    }
  })()
  if (folder) console.log(`[library] pruned ${drop.length} tracks no longer under ${folder}`)
  return drop.length
}

export function getTags(filename: string): string[] {
  const db = getDb()
  const rows = db.prepare('SELECT tag FROM track_tags WHERE filename = ? ORDER BY tag').all(filename) as {
    tag: string
  }[]
  return rows.map((r) => r.tag)
}

export function setTags(filename: string, tags: string[]): void {
  const db = getDb()
  const normalized = [...new Set(tags.map((t) => t.toLowerCase().trim()).filter(Boolean))]
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM track_tags WHERE filename = ?').run(filename)
    const insert = db.prepare('INSERT INTO track_tags (filename, tag) VALUES (?, ?)')
    for (const tag of normalized) {
      insert.run(filename, tag)
    }
  })
  tx()
}

export function getAllTags(): string[] {
  const db = getDb()
  const rows = db.prepare('SELECT DISTINCT tag FROM track_tags ORDER BY tag').all() as { tag: string }[]
  return rows.map((r) => r.tag)
}

export function getTagsMap(): Record<string, string[]> {
  const db = getDb()
  const rows = db.prepare('SELECT filename, tag FROM track_tags ORDER BY filename, tag').all() as {
    filename: string
    tag: string
  }[]
  const map: Record<string, string[]> = {}
  for (const row of rows) {
    if (!map[row.filename]) map[row.filename] = []
    map[row.filename].push(row.tag)
  }
  return map
}

// ── Play history queries ──────────────────────────────────────────────────────

export function recordPlay(itemId: string, itemType: 'music' | 'sfx'): void {
  const db = getDb()
  db.prepare('INSERT INTO play_history (item_id, item_type) VALUES (?, ?)').run(itemId, itemType)
}

/**
 * Get play frequency counts for a given item type.
 * Returns a map of item_id -> play count, ordered by most played.
 */
export function getPlayFrequencies(itemType: 'music' | 'sfx'): Record<string, number> {
  const db = getDb()
  const rows = db
    .prepare('SELECT item_id, COUNT(*) as cnt FROM play_history WHERE item_type = ? GROUP BY item_id ORDER BY cnt DESC')
    .all(itemType) as { item_id: string; cnt: number }[]
  const map: Record<string, number> = {}
  for (const row of rows) {
    map[row.item_id] = row.cnt
  }
  return map
}

/**
 * Get the top N most played items of a given type.
 * Returns item IDs ordered by play count descending.
 */
export function getTopPlayed(itemType: 'music' | 'sfx', limit = 10): string[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT item_id FROM play_history WHERE item_type = ? GROUP BY item_id ORDER BY COUNT(*) DESC LIMIT ?')
    .all(itemType, limit) as { item_id: string }[]
  return rows.map((r) => r.item_id)
}

export function closeDb(): void {
  db?.close()
  db = null
}

// ── Lane overrides ────────────────────────────────────────────────────────────

/** Every label the DM has set, by library key. */
export function getLaneOverrides(): Record<string, 'music' | 'sfx'> {
  const rows = getDb().prepare('SELECT path, lane FROM lane_overrides').all() as Array<{
    path: string
    lane: 'music' | 'sfx'
  }>
  const out: Record<string, 'music' | 'sfx'> = {}
  for (const row of rows) out[row.path] = row.lane
  return out
}

export function clearLaneOverride(path: string): void {
  getDb().prepare('DELETE FROM lane_overrides WHERE path = ?').run(path)
}

export function setLaneOverride(path: string, lane: 'music' | 'sfx'): void {
  getDb()
    .prepare(
      'INSERT INTO lane_overrides (path, lane, updated_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET lane = ?, updated_at = ?',
    )
    .run(path, lane, Date.now(), lane, Date.now())
}

// ── Effect durations ──────────────────────────────────────────────────────────

/** Measured seconds per absolute path, for effects that have been probed. */
export function getSfxDurations(): Record<string, number> {
  const rows = getDb().prepare('SELECT path, duration FROM sfx_durations').all() as Array<{
    path: string
    duration: number
  }>
  const out: Record<string, number> = {}
  for (const row of rows) out[row.path] = row.duration
  return out
}

/** Forget every measured effect: "Re-analyse" means the stored seconds are suspect. */
export function clearSfxDurations(): void {
  getDb().prepare('DELETE FROM sfx_durations').run()
}

export function setSfxDuration(path: string, duration: number): void {
  getDb()
    .prepare(
      'INSERT INTO sfx_durations (path, duration, updated_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET duration = ?, updated_at = ?',
    )
    .run(path, duration, Date.now(), duration, Date.now())
}
