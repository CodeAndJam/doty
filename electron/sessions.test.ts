import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock electron modules before importing sessions
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}))
vi.mock('./store', () => ({
  store: {
    get: vi.fn().mockReturnValue(''),
    set: vi.fn(),
  },
}))

import { deleteSession, loadSessionAsync } from './sessions'

describe('loadSessionAsync', () => {
  let tmpFile: string

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `test-session-${Date.now()}.vtt`)
  })

  afterEach(() => {
    try {
      fs.unlinkSync(tmpFile)
    } catch {}
  })

  it('parses VTT cues correctly', async () => {
    const content = `WEBVTT
NOTE
Name: Test Session
Created: 2026-01-01T00:00:00.000Z

00:00:01.000 --> 00:00:04.000
Hello world

00:00:05.000 --> 00:00:08.000
Second line
`
    fs.writeFileSync(tmpFile, content, 'utf-8')
    const cues = await loadSessionAsync(tmpFile)
    expect(cues).toHaveLength(2)
    expect(cues[0]).toEqual({ start: '00:00:01.000', end: '00:00:04.000', text: 'Hello world' })
    expect(cues[1]).toEqual({ start: '00:00:05.000', end: '00:00:08.000', text: 'Second line' })
  })

  it('returns empty array for non-existent file', async () => {
    const cues = await loadSessionAsync('/nonexistent/file.vtt')
    expect(cues).toEqual([])
  })

  it('handles empty VTT file with only header', async () => {
    fs.writeFileSync(tmpFile, 'WEBVTT\nNOTE\nName: Empty\n\n', 'utf-8')
    const cues = await loadSessionAsync(tmpFile)
    expect(cues).toEqual([])
  })
})

describe('deleteSession', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doty-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('deletes both .vtt and .wav files', () => {
    const vttPath = path.join(tmpDir, 'session.vtt')
    const wavPath = path.join(tmpDir, 'session.wav')
    fs.writeFileSync(vttPath, 'WEBVTT\n', 'utf-8')
    fs.writeFileSync(wavPath, Buffer.alloc(44))
    deleteSession(vttPath)
    expect(fs.existsSync(vttPath)).toBe(false)
    expect(fs.existsSync(wavPath)).toBe(false)
  })

  it('deletes VTT even if WAV does not exist', () => {
    const vttPath = path.join(tmpDir, 'session.vtt')
    fs.writeFileSync(vttPath, 'WEBVTT\n', 'utf-8')
    deleteSession(vttPath)
    expect(fs.existsSync(vttPath)).toBe(false)
  })

  it('does nothing for non-existent file', () => {
    expect(() => deleteSession('/nonexistent/file.vtt')).not.toThrow()
  })
})
