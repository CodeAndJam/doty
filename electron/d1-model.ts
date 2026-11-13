/**
 * d1-model.ts — where the ranker graph lives and how it gets there.
 *
 * The graph, its manifest and the tokenizer travel as one archive, so a first
 * run is one request, one checksum and one extraction rather than three
 * downloads that can disagree with each other. Nothing here re-downloads: the
 * archive is only fetched when `isRankerInstalled()` is false.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { join } from 'node:path'
import { MODELS_DIR } from './models-dir'
import { resolveLanguage } from './stt-language'

/** GitHub rejects release assets over 2 GB; this archive is ~1.5 GB. */
export const RANKER_ARCHIVE = 'd1-omni-text-v1.tar.gz'

/**
 * The release the app downloads from. Upload `RANKER_ARCHIVE` to a release
 * tagged `models-v1` before shipping: the export script writes it to
 * ~/.doty/models, next to the graph.
 */
export const RANKER_URL = `https://github.com/CodeAndJam/doty/releases/download/models-v1/${RANKER_ARCHIVE}`

/** sha256 of the archive, printed by `scripts/export-d1-omni.py --pack`. */
export const RANKER_SHA256 = 'c825fa241b4c61db398dc93de2c77ffc1b0e944f7d7f5328aab94eb448d49c9f'

const GRAPH = 'd1-omni-text.onnx'
const MANIFEST = 'd1-omni-text-manifest.json'
const TOKENIZER = join('d1-omni-src', 'tokenizer.json')
const TOKENIZER_CONFIG = join('d1-omni-src', 'tokenizer_config.json')

export function rankerPaths(dir = MODELS_DIR) {
  return {
    dir,
    graph: join(dir, GRAPH),
    manifest: join(dir, MANIFEST),
    archive: join(dir, RANKER_ARCHIVE),
  }
}

/** The graph is only usable when its manifest and tokenizer are beside it. */
export function isRankerInstalled(dir = MODELS_DIR): boolean {
  try {
    return [GRAPH, MANIFEST, TOKENIZER, TOKENIZER_CONFIG].every((f) => {
      const stat = fs.statSync(join(dir, f))
      return stat.isFile() && stat.size > 0
    })
  } catch {
    return false
  }
}

/**
 * The languages this build's ranker can read, from the manifest. Empty when the
 * model is not installed yet, which must not disable anything by itself.
 */
export function rankerLanguages(dir = MODELS_DIR): string[] {
  try {
    const manifest = JSON.parse(fs.readFileSync(join(dir, MANIFEST), 'utf8')) as { languages?: unknown }
    return Array.isArray(manifest.languages) ? (manifest.languages as string[]) : []
  } catch {
    return []
  }
}

/**
 * Whether the ranker reads the language the table is speaking. `auto` is let
 * through: the model reads the transcript itself, and guessing is no worse than
 * refusing. An empty list (older manifest, model not installed) also passes, so
 * a missing fact never silently disables the model.
 */
export function coversLanguage(languages: string[], configured: string | undefined): boolean {
  if (!configured || configured === 'auto') return true
  if (languages.length === 0) return true
  return resolveLanguage(configured, languages) !== undefined
}

export function sha256File(path: string): string {
  return createHash('sha256').update(fs.readFileSync(path)).digest('hex')
}

/**
 * Unpack the archive into the models dir. bsdtar ships with macOS; the archive
 * holds only relative paths, so it cannot write outside `dir`.
 */
export function extractRankerArchive(archive: string, dir = MODELS_DIR): void {
  execFileSync('tar', ['-xzf', archive, '-C', dir], { stdio: 'ignore' })
}

/** Throws when the downloaded archive is not the one this build expects. */
export function verifyArchive(archive: string, expected = RANKER_SHA256): void {
  const actual = sha256File(archive)
  if (actual !== expected) throw new Error(`ranker archive checksum ${actual} != ${expected}`)
}

/** Verify, extract, then drop the archive so a 1.5 GB download is not kept twice. */
export function installRankerArchive(archive: string, dir = MODELS_DIR, expected = RANKER_SHA256): void {
  if (isRankerInstalled(dir)) {
    fs.rmSync(archive, { force: true })
    return
  }
  verifyArchive(archive, expected)
  extractRankerArchive(archive, dir)
  fs.rmSync(archive, { force: true })
  if (!isRankerInstalled(dir)) throw new Error('ranker archive extracted but the model is incomplete')
}
