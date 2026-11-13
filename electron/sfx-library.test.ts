import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listSfx } from './sfx-library'

const dirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(join(tmpdir(), 'doty-sfx-'))
  dirs.push(dir)
  return dir
}

function touch(path: string): void {
  fs.mkdirSync(join(path, '..'), { recursive: true })
  fs.writeFileSync(path, '')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('sfx library', () => {
  it('lists audio files with their folder as category', () => {
    const root = tempDir()
    touch(join(root, 'combat', 'sword_hit.mp3'))
    touch(join(root, 'rain.ogg'))
    touch(join(root, 'combat', 'notes.txt'))

    const items = listSfx(root)
    expect(items.map((i) => [i.id, i.category, i.label])).toEqual([
      [join('combat', 'sword_hit.mp3'), 'combat', 'sword hit'],
      ['rain.ogg', 'custom', 'rain'],
    ])
    expect(items[0].filename).toBe(join(root, 'combat', 'sword_hit.mp3'))
  })

  it('returns nothing for a missing or empty folder', () => {
    expect(listSfx('')).toEqual([])
    expect(listSfx(join(tmpdir(), 'doty-does-not-exist'))).toEqual([])
  })
})
