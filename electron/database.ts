import { join } from 'path'
import { app } from 'electron'
import Database from 'better-sqlite3'

const DB_PATH = join(app.getPath('home'), '.doty', 'doty.db')

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const fs = require('fs')
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

  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
