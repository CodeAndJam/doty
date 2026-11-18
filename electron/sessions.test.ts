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

import { appendCue, deleteSession, getLastCueStartMs, loadSessionAsync, renameSession } from './sessions'

describe('getLastCueStartMs', () => {
  it('returns the start of the last cue, not its end', () => {
    const file = path.join(os.tmpdir(), `test-cue-${Date.now()}.vtt`)
    fs.writeFileSync(
      file,
      'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nfirst\n\n00:00:10.500 --> 00:00:13.500\nsecond\n\n',
    )
    expect(getLastCueStartMs(file)).toBe(10_500)
    expect(getLastCueStartMs(path.join(os.tmpdir(), 'does-not-exist.vtt'))).toBe(0)
    fs.unlinkSync(file)
  })
})

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

  it('reads a WebVTT voice span back into a speaker, leaving plain cues alone', async () => {
    const content = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Ana>olá malta</v>

00:00:05.000 --> 00:00:08.000
I say this into the mic
`
    fs.writeFileSync(tmpFile, content, 'utf-8')
    const cues = await loadSessionAsync(tmpFile)
    expect(cues[0]).toEqual({ start: '00:00:01.000', end: '00:00:04.000', text: 'olá malta', speaker: 'Ana' })
    expect(cues[1]).toEqual({
      start: '00:00:05.000',
      end: '00:00:08.000',
      text: 'I say this into the mic',
    })
  })

  it('keeps a display name that would break the voice span out of the tag', async () => {
    appendCue(tmpFile, 1000, 'olá malta', 'Ana <script>')
    appendCue(tmpFile, 2000, 'closes early </v> here', 'Cabeda')
    const cues = await loadSessionAsync(tmpFile)
    expect(cues[0]).toEqual({ start: '00:00:01.000', end: '00:00:04.000', text: 'olá malta', speaker: 'Ana script' })
    expect(cues[1].speaker).toBe('Cabeda')
    expect(cues[1].text).toBe('closes early  here')
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
    const remotePath = path.join(tmpDir, 'session-remote.wav')
    fs.writeFileSync(vttPath, 'WEBVTT\n', 'utf-8')
    fs.writeFileSync(wavPath, Buffer.alloc(44))
    fs.writeFileSync(remotePath, Buffer.alloc(44))
    deleteSession(vttPath)
    expect(fs.existsSync(vttPath)).toBe(false)
    expect(fs.existsSync(wavPath)).toBe(false)
    expect(fs.existsSync(remotePath)).toBe(false)
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

describe('renameSession', () => {
  it('keeps a dollar sign in the name as text, not a replacement pattern', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doty-session-'))
    const file = path.join(dir, 's.vtt')
    fs.writeFileSync(file, 'WEBVTT\nNOTE\nName: Old\nCreated: 2026-01-01\n\n')
    renameSession(file, 'Tavern $& loot $1')
    expect(fs.readFileSync(file, 'utf-8')).toContain('Name: Tavern $& loot $1')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
