import { getDb } from './database'

let vecLoaded = false

/** Load sqlite-vec extension into the database */
function ensureVecExtension(): void {
  if (vecLoaded) return
  const db = getDb()
  try {
    // sqlite-vec npm package provides the loadable extension path
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqliteVec = require('sqlite-vec')
    sqliteVec.load(db)
    vecLoaded = true
  } catch (e) {
    console.error('[track-vectors] Failed to load sqlite-vec:', e)
    throw e
  }
}

const EMBEDDING_DIM = 768

/** Initialize the vector table and metadata table */
export function initVectorTables(): void {
  ensureVecExtension()
  const db = getDb()

  // Metadata table tracks descriptions and source
  db.exec(`
    CREATE TABLE IF NOT EXISTS track_embedding_meta (
      filename    TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      source      TEXT NOT NULL DEFAULT 'tags',
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  // vec0 virtual table for KNN search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS track_vec USING vec0(
      embedding float[${EMBEDDING_DIM}]
    )
  `)
}

/** Get the rowid for a filename (used to map vec0 rowids to filenames) */
function getRowId(filename: string): number | null {
  const db = getDb()
  const row = db.prepare('SELECT rowid FROM track_embedding_meta WHERE filename = ?').get(filename) as
    | { rowid: number }
    | undefined
  return row?.rowid ?? null
}

/** Store a track embedding (insert or update) */
export function upsertTrackEmbedding(
  filename: string,
  description: string,
  embedding: Float32Array | number[],
  source: 'tags' | 'llm',
): void {
  const db = getDb()
  const vec = embedding instanceof Float32Array ? embedding : new Float32Array(embedding)
  const vecBuffer = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)

  const existingRowId = getRowId(filename)

  if (existingRowId !== null) {
    // Update existing
    db.prepare(
      'UPDATE track_embedding_meta SET description = ?, source = ?, updated_at = unixepoch() WHERE filename = ?',
    ).run(description, source, filename)
    db.prepare('UPDATE track_vec SET embedding = ? WHERE rowid = ?').run(vecBuffer, existingRowId)
  } else {
    // Insert new
    const metaResult = db
      .prepare('INSERT INTO track_embedding_meta (filename, description, source) VALUES (?, ?, ?)')
      .run(filename, description, source)
    const rowid = metaResult.lastInsertRowid
    db.prepare('INSERT INTO track_vec (rowid, embedding) VALUES (?, ?)').run(rowid, vecBuffer)
  }
}

/** Check if a track already has an embedding */
export function hasEmbedding(filename: string): boolean {
  const db = getDb()
  const row = db.prepare('SELECT 1 FROM track_embedding_meta WHERE filename = ?').get(filename)
  return row !== undefined
}

/** Get tracks that need embedding (no entry in track_embedding_meta) */
export function getTracksNeedingEmbedding(allFiles: string[], limit = 50): string[] {
  const db = getDb()
  // Get all filenames that already have embeddings
  const existing = new Set(
    (db.prepare('SELECT filename FROM track_embedding_meta').all() as { filename: string }[]).map((r) => r.filename),
  )
  return allFiles.filter((f) => !existing.has(f)).slice(0, limit)
}

/** Get embedding stats for progress reporting */
export function getEmbeddingStats(totalFiles: number): { embedded: number; total: number; percent: number } {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as count FROM track_embedding_meta').get() as { count: number }
  const embedded = row.count
  return { embedded, total: totalFiles, percent: totalFiles > 0 ? Math.round((embedded / totalFiles) * 100) : 0 }
}

/**
 * Search for the top-K most similar tracks to a query embedding.
 * Returns filenames sorted by similarity (closest first).
 */
export function searchSimilarTracks(
  queryEmbedding: Float32Array | number[],
  limit = 10,
): Array<{ filename: string; distance: number }> {
  const db = getDb()
  const vec = queryEmbedding instanceof Float32Array ? queryEmbedding : new Float32Array(queryEmbedding)
  const vecBuffer = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)

  const rows = db
    .prepare(
      `SELECT tv.rowid, tv.distance, tem.filename
       FROM track_vec tv
       JOIN track_embedding_meta tem ON tem.rowid = tv.rowid
       WHERE tv.embedding MATCH ?
       ORDER BY tv.distance
       LIMIT ?`,
    )
    .all(vecBuffer, limit) as Array<{ rowid: number; distance: number; filename: string }>

  return rows.map((r) => ({ filename: r.filename, distance: r.distance }))
}

/** Remove embeddings for tracks that no longer exist in the library */
export function pruneStaleEmbeddings(currentFiles: Set<string>): number {
  const db = getDb()
  const allEmbedded = db.prepare('SELECT rowid, filename FROM track_embedding_meta').all() as Array<{
    rowid: number
    filename: string
  }>
  const stale = allEmbedded.filter((r) => !currentFiles.has(r.filename))

  if (stale.length === 0) return 0

  const tx = db.transaction(() => {
    for (const { rowid, filename } of stale) {
      db.prepare('DELETE FROM track_vec WHERE rowid = ?').run(rowid)
      db.prepare('DELETE FROM track_embedding_meta WHERE filename = ?').run(filename)
    }
  })
  tx()
  return stale.length
}

/** Get the total number of embedded tracks */
export function getEmbeddedCount(): number {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as count FROM track_embedding_meta').get() as { count: number }
  return row.count
}
