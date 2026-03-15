import { join } from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'

const DB_PATH = join(app.getPath('home'), '.doty', 'doty.db')

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
      bitrate     INTEGER,
      sample_rate INTEGER,
      channels    INTEGER,
      codec       TEXT,
      mtime       REAL,
      scanned_at  TEXT DEFAULT (datetime('now'))
    )
  `)

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

  return db
}

// ── Tag queries ───────────────────────────────────────────────────────────────

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
