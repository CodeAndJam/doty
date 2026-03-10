import { join } from 'path'
import { app } from 'electron'
import fs from 'fs'
import type { TrackMetadata } from './analyzer'

const CACHE_PATH = join(app.getPath('home'), '.doty', 'music-metadata.json')

type Cache = Record<string, TrackMetadata>

function load(): Cache {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function save(cache: Cache): void {
  fs.mkdirSync(join(CACHE_PATH, '..'), { recursive: true })
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache), 'utf-8')
}

export function getCache(): Cache {
  return load()
}

export function getCached(relPath: string): TrackMetadata | null {
  return load()[relPath] ?? null
}

export function setCached(relPath: string, meta: TrackMetadata): void {
  const cache = load()
  cache[relPath] = meta
  save(cache)
}

export function removeCached(relPath: string): void {
  const cache = load()
  delete cache[relPath]
  save(cache)
}

export function clearCache(): void {
  save({})
}
