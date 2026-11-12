import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getMusicFiles, invalidateMusicLibrary } from './music-library'

const dirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(join(tmpdir(), 'doty-library-'))
  dirs.push(dir)
  return dir
}

function touch(path: string): void {
  fs.mkdirSync(join(path, '..'), { recursive: true })
  fs.writeFileSync(path, '')
}

afterEach(() => {
  invalidateMusicLibrary()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('music library cache', () => {
  it('returns audio files relative to the music folder', () => {
    const root = tempDir()
    touch(join(root, 'a.mp3'))
    touch(join(root, 'sub', 'b.flac'))
    touch(join(root, 'sub', 'notes.txt'))

    expect(getMusicFiles(root).sort()).toEqual(['a.mp3', join('sub', 'b.flac')])
  })

  it('does not re-walk the folder on every call', () => {
    const root = tempDir()
    touch(join(root, 'a.mp3'))

    expect(getMusicFiles(root)).toEqual(['a.mp3'])
    // Added outside the cache: still served from cache until invalidated.
    touch(join(root, 'b.mp3'))
    expect(getMusicFiles(root)).toEqual(['a.mp3'])

    invalidateMusicLibrary()
    expect(getMusicFiles(root).sort()).toEqual(['a.mp3', 'b.mp3'])
  })

  it('re-walks when the folder changes', () => {
    const first = tempDir()
    const second = tempDir()
    touch(join(first, 'a.mp3'))
    touch(join(second, 'b.mp3'))

    expect(getMusicFiles(first)).toEqual(['a.mp3'])
    expect(getMusicFiles(second)).toEqual(['b.mp3'])
  })

  it('returns an empty list when no folder is set', () => {
    expect(getMusicFiles('')).toEqual([])
  })
})
