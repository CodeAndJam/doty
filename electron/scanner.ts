import fs from 'node:fs'
import { join } from 'node:path'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import { analyzeFile } from './analyzer'
import type { FullTrackMetadata } from './metadata-cache'
import { clearCache, getCache, getCached, removeCached, setCached } from './metadata-cache'

const AUDIO_RE = /\.(mp3|flac|wav|m4a|ogg|aac)$/i
const CONCURRENCY = 2

type ProgressCallback = (done: number, total: number, current: string) => void
type CompleteCallback = () => void

let watcher: FSWatcher | null = null
let queue: string[] = [] // absolute paths
let active = 0
let done = 0
let total = 0
let musicRoot = ''
let onProgress: ProgressCallback | null = null
let onComplete: CompleteCallback | null = null

function relPath(absPath: string): string {
  return absPath.slice(musicRoot.length + 1)
}

function processNext() {
  while (active < CONCURRENCY && queue.length > 0) {
    const absPath = queue.shift()!
    active++
    const rel = relPath(absPath)
    onProgress?.(done, total, rel)

    analyzeFile(absPath)
      .then((meta) => setCached(rel, meta as FullTrackMetadata))
      .catch((e) => console.error(`[scanner] failed ${rel}:`, e))
      .finally(() => {
        active--
        done++
        onProgress?.(done, total, rel)
        if (queue.length > 0) {
          processNext()
        } else if (active === 0) {
          onComplete?.()
        }
      })
  }
}

function enqueue(absPath: string) {
  if (!queue.includes(absPath)) {
    queue.push(absPath)
    total++
    processNext()
  }
}

function listAll(dir: string): string[] {
  const results: string[] = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) results.push(...listAll(full))
      else if (AUDIO_RE.test(entry.name)) results.push(full)
    }
  } catch {
    /* skip */
  }
  return results
}

export function startScanner(
  folder: string,
  progressCb: ProgressCallback,
  completeCb: CompleteCallback,
  force = false,
) {
  stopScanner()
  musicRoot = folder
  onProgress = progressCb
  onComplete = completeCb
  queue = []
  active = 0
  done = 0
  total = 0

  if (force) clearCache()

  const cache = getCache()
  const allFiles = listAll(folder)

  // Queue only stale or missing files
  for (const absPath of allFiles) {
    const rel = relPath(absPath)
    const cached = cache[rel]
    if (!cached) {
      enqueue(absPath)
    } else {
      try {
        const mtime = fs.statSync(absPath).mtimeMs
        if (mtime !== cached.mtime) enqueue(absPath)
      } catch {
        /* file gone */
      }
    }
  }

  if (queue.length === 0) {
    // Everything cached — fire complete immediately
    completeCb()
  }

  // Watch for changes — chokidar v4 uses native fs.watch (no fsevents dependency)
  try {
    watcher = chokidarWatch(folder, {
      ignoreInitial: true,
      persistent: true,
    })

    watcher.on('add', (absPath: string) => {
      if (AUDIO_RE.test(absPath)) {
        total++
        enqueue(absPath)
      }
    })

    watcher.on('change', (absPath: string) => {
      if (AUDIO_RE.test(absPath)) enqueue(absPath)
    })

    watcher.on('unlink', (absPath: string) => {
      if (AUDIO_RE.test(absPath)) removeCached(relPath(absPath))
    })
  } catch (e) {
    console.error('[scanner] chokidar watch failed (non-fatal):', e)
    watcher = null
  }
}

export function stopScanner() {
  watcher?.close()
  watcher = null
  queue = []
  active = 0
}

function forceRescan(folder: string, progressCb: ProgressCallback, completeCb: CompleteCallback) {
  startScanner(folder, progressCb, completeCb, true)
}

export function getMetadata(relativeOrAbsPath: string): FullTrackMetadata | null {
  const rel = relativeOrAbsPath.startsWith(musicRoot)
    ? relativeOrAbsPath.slice(musicRoot.length + 1)
    : relativeOrAbsPath
  return getCached(rel)
}

export function getAllMetadata(): Record<string, FullTrackMetadata> {
  return getCache()
}
