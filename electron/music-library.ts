import fs from 'node:fs'
import { join } from 'node:path'

const AUDIO_RE = /\.(mp3|flac|wav|m4a|ogg|aac)$/i

let cachedFolder: string | null = null
let cachedFiles: string[] = []

function walk(dir: string, base: string, out: string[]): void {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, base, out)
      } else if (AUDIO_RE.test(entry.name)) {
        out.push(full.slice(base.length + 1))
      }
    }
  } catch {
    /* skip unreadable dirs */
  }
}

/**
 * Relative paths of audio files under `folder`. The recursive walk happens once
 * per folder; call `invalidateMusicLibrary()` when the scanner sees changes.
 */
export function getMusicFiles(folder: string): string[] {
  if (!folder) return []
  if (folder !== cachedFolder) {
    cachedFiles = []
    walk(folder, folder, cachedFiles)
    cachedFolder = folder
  }
  return cachedFiles
}

export function invalidateMusicLibrary(): void {
  cachedFolder = null
  cachedFiles = []
}
