import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const spawn = vi.hoisted(() => vi.fn())
const binary = '/Applications/Doty.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'

// execFile is only reached by `ffmpegStatus`; mocked so the module loads.
vi.mock('node:child_process', () => ({ spawn, execFile: vi.fn() }))
vi.mock('./ffmpeg', () => ({ ffmpegBinary: () => binary }))

import { createMusicResource, createSfxResource } from './discord-audio'

const dir = fs.mkdtempSync(join(tmpdir(), 'doty-audio-'))
const track = join(dir, 'track.mp3')
fs.writeFileSync(track, '')

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

beforeEach(() => {
  spawn.mockReset()
  spawn.mockReturnValue({ stdout: new PassThrough(), once: vi.fn(), kill: vi.fn() })
})

describe('discord audio pipeline', () => {
  it('spawns the unpacked ffmpeg, not a should-be-unpacked path or PATH', () => {
    const resource = createMusicResource(dir, 'track.mp3')
    expect(spawn).toHaveBeenCalledWith(
      binary,
      expect.any(Array),
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'ignore'] }),
    )
    resource.playStream.destroy()
  })

  it('seeks before the input and asks for 48 kHz stereo PCM', () => {
    const resource = createMusicResource(dir, 'track.mp3', 0.5, 12)
    const args = spawn.mock.calls[0][1] as string[]
    expect(args.slice(0, 2)).toEqual(['-ss', '12'])
    expect(args).toContain(track)
    expect(args.slice(-7)).toEqual(['-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'])
    resource.playStream.destroy()
  })

  it('uses the same decoder for an absolute SFX path', () => {
    const resource = createSfxResource(track)
    expect(spawn).toHaveBeenCalledWith(binary, expect.arrayContaining(['-i', track]), expect.anything())
    resource.playStream.destroy()
  })

  it('refuses a missing file before spawning anything', () => {
    expect(() => createMusicResource(dir, 'missing.mp3')).toThrow('File not found')
    expect(spawn).not.toHaveBeenCalled()
  })
})
