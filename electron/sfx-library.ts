import fs from 'node:fs'
import { join } from 'node:path'

export interface SfxItem {
  /** Path relative to the SFX folder (also the renderer's SfxMeta.id). */
  id: string
  filename: string
  category: string
  label: string
  description: string
  duration: number
  source: 'builtin' | 'custom'
}

const AUDIO_RE = /\.(mp3|flac|wav|m4a|ogg|aac)$/i

function walk(dir: string, base: string, category: string, out: SfxItem[]): void {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, base, entry.name, out)
      } else if (AUDIO_RE.test(entry.name)) {
        out.push({
          id: full.slice(base.length + 1),
          filename: full,
          category: category || 'custom',
          label: entry.name.replace(AUDIO_RE, '').replace(/[-_]/g, ' '),
          description: '',
          duration: 0,
          source: 'custom',
        })
      }
    }
  } catch (e) {
    console.error('[sfx] scan error:', e)
  }
}

/** Audio files under `folder`, one level of category from the folder name. */
export function listSfx(folder: string, durations: Record<string, number> = {}): SfxItem[] {
  if (!folder || !fs.existsSync(folder)) return []
  const items: SfxItem[] = []
  walk(folder, folder, '', items)
  // A measured duration decides the lane; zero means "not probed yet" and the
  // classifier falls back to the folder, which is where the DM put it.
  for (const item of items) item.duration = durations[item.filename] ?? 0
  return items
}
