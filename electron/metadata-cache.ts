import type { TrackMetadata } from './analyzer'
import { getDb } from './database'

export interface FullTrackMetadata extends TrackMetadata {
  title: string | null
  artist: string | null
  album: string | null
  genre: string | null
  year: number | null
  trackNo: number | null
  bitrate: number | null
  sampleRate: number | null
  channels: number | null
  codec: string | null
}

type TrackRow = {
  path: string
  title: string | null
  artist: string | null
  album: string | null
  genre: string | null
  year: number | null
  track_no: number | null
  duration: number
  bpm: number
  bpm_confidence: number
  key: string
  scale: string
  danceability: number
  energy: number
  bitrate: number | null
  sample_rate: number | null
  channels: number | null
  codec: string | null
  mtime: number
}

function rowToMeta(row: TrackRow): FullTrackMetadata {
  return {
    title: row.title,
    artist: row.artist,
    album: row.album,
    genre: row.genre,
    year: row.year,
    trackNo: row.track_no,
    duration: row.duration,
    bpm: row.bpm,
    bpmConfidence: row.bpm_confidence,
    key: row.key,
    scale: row.scale,
    danceability: row.danceability,
    energy: row.energy,
    bitrate: row.bitrate,
    sampleRate: row.sample_rate,
    channels: row.channels,
    codec: row.codec,
    mtime: row.mtime,
  }
}

export function getCached(relPath: string): FullTrackMetadata | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM tracks WHERE path = ?').get(relPath) as TrackRow | undefined
  return row ? rowToMeta(row) : null
}

export function setCached(relPath: string, meta: FullTrackMetadata): void {
  const db = getDb()
  db.prepare(`
    INSERT OR REPLACE INTO tracks
      (path, title, artist, album, genre, year, track_no, duration,
       bpm, bpm_confidence, key, scale, danceability, energy,
       bitrate, sample_rate, channels, codec, mtime, scanned_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    relPath,
    meta.title,
    meta.artist,
    meta.album,
    meta.genre,
    meta.year,
    meta.trackNo,
    meta.duration,
    meta.bpm,
    meta.bpmConfidence,
    meta.key,
    meta.scale,
    meta.danceability,
    meta.energy,
    meta.bitrate,
    meta.sampleRate,
    meta.channels,
    meta.codec,
    meta.mtime,
  )
}

export function removeCached(relPath: string): void {
  const db = getDb()
  db.prepare('DELETE FROM tracks WHERE path = ?').run(relPath)
}

export function clearCache(): void {
  const db = getDb()
  db.prepare('DELETE FROM tracks').run()
}

export function getCache(): Record<string, FullTrackMetadata> {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM tracks').all() as TrackRow[]
  const result: Record<string, FullTrackMetadata> = {}
  for (const row of rows) {
    result[row.path] = rowToMeta(row)
  }
  return result
}

export function migrateFromJson(): void {
  const { join } = require('node:path')
  const { app: electronApp } = require('electron')
  const fs = require('node:fs')

  const jsonPath = join(electronApp.getPath('home'), '.doty', 'music-metadata.json')
  if (!fs.existsSync(jsonPath)) return

  try {
    const data: Record<string, TrackMetadata> = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    const db = getDb()
    const insert = db.prepare(`
      INSERT OR IGNORE INTO tracks
        (path, duration, bpm, bpm_confidence, key, scale, danceability, energy, mtime)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const tx = db.transaction(() => {
      for (const [path, meta] of Object.entries(data)) {
        insert.run(
          path,
          meta.duration,
          meta.bpm,
          meta.bpmConfidence,
          meta.key,
          meta.scale,
          meta.danceability,
          meta.energy,
          meta.mtime,
        )
      }
    })
    tx()

    // Rename old file so we don't migrate again
    fs.renameSync(jsonPath, `${jsonPath}.migrated`)
    console.log(`[db] migrated ${Object.keys(data).length} tracks from JSON to SQLite`)
  } catch (e) {
    console.error('[db] JSON migration failed:', e)
  }
}
