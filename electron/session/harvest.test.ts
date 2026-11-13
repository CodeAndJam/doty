/**
 * Builds the labelling rows the ranker lab opens.
 *
 * A row is exactly what the app builds at that moment: the transcript, the
 * twenty candidates the prefilter offered, and how each one was described to
 * the model. Rows built any other way measure a pipeline nobody runs.
 *
 *   pnpm ranker:rows      # writes test-fixtures/ranker/rows.json
 *
 * @vitest-environment node
 */

import fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, it } from 'vitest'
import { candidateSet } from '../../src/lib/heuristicRecommend'
import { describeTrack } from '../../src/lib/rankTracks'

const FIXTURES = join(__dirname, '..', '..', 'test-fixtures', 'ranker')
const TRANSCRIPTS = join(FIXTURES, 'transcripts.json')
const ROWS = join(FIXTURES, 'rows.json')
const DB = join(homedir(), '.doty', 'doty.db')

interface Transcript {
  id: string
  text: string
}

describe.skipIf(process.env.RANKER_ROWS !== '1')('harvest ranker rows', () => {
  it('writes rows shaped exactly like production', () => {
    if (!fs.existsSync(TRANSCRIPTS)) throw new Error(`write ${TRANSCRIPTS} first: [{ "id", "text" }]`)
    const transcripts = JSON.parse(fs.readFileSync(TRANSCRIPTS, 'utf8')) as Transcript[]

    const db = new Database(DB, { readonly: true })
    const tracks = db.prepare('select path, bpm, energy, scale, danceability from tracks').all() as Array<{
      path: string
      bpm: number
      energy: number
      scale: string
      danceability: number
    }>
    const files = tracks.map((t) => t.path)
    const metadata: Record<string, never> = {}
    for (const t of tracks) {
      metadata[t.path] = { bpm: t.bpm, energy: t.energy, scale: t.scale, danceability: t.danceability } as never
    }
    const tags = db.prepare('select filename, tag from track_tags').all() as Array<{ filename: string; tag: string }>
    const tagsMap: Record<string, string[]> = {}
    for (const t of tags) {
      if (!tagsMap[t.filename]) tagsMap[t.filename] = []
      tagsMap[t.filename].push(t.tag)
    }

    const rows = transcripts.map((t) => {
      const paths = candidateSet(t.text, files, metadata, 20, tagsMap, {})
      return {
        id: t.id,
        transcript: t.text,
        candidates: paths.map((path) => ({
          path,
          description: describeTrack(path, metadata[path], tagsMap[path] ?? []),
        })),
      }
    })

    fs.mkdirSync(FIXTURES, { recursive: true })
    fs.writeFileSync(ROWS, `${JSON.stringify(rows, null, 1)}\n`)
    console.log(`[ranker] wrote ${rows.length} rows to ${ROWS}`)
  }, 60_000)
})
