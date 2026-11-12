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
export function listSfx(folder: string): SfxItem[] {
  if (!folder || !fs.existsSync(folder)) return []
  const items: SfxItem[] = []
  walk(folder, folder, '', items)
  return items
}
