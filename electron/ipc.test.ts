import fs from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONTEXT_LIMITS, DEFAULT_CONTEXT, mergeContext } from '../src/lib/context'
import { EVENTS, INVOKE } from './ipc'
import { ARGS, decodeArgs } from './ipc-schema'

const dir = join(process.cwd(), 'electron')
const read = (file: string) => fs.readFileSync(join(dir, file), 'utf8')

function rawCalls(source: string, call: RegExp): string[] {
  return source.split('\n').flatMap((line, i) => (call.test(line) ? [`${i + 1}: ${line.trim()}`] : []))
}

describe('IPC channel registry', () => {
  it('declares every channel exactly once', () => {
    for (const channels of [Object.values(INVOKE), Object.values(EVENTS)]) {
      expect(new Set(channels).size).toBe(channels.length)
    }
  })

  it('names channels domain:action', () => {
    for (const channel of [...Object.values(INVOKE), ...Object.values(EVENTS)]) {
      expect(channel).toMatch(/^[a-z]+:[a-z0-9-]+$/)
    }
  })

  it('never passes a raw channel string to ipcMain or ipcRenderer', () => {
    const violations = [
      ...rawCalls(read('main.ts'), /ipcMain\.handle\(\s*['"`]/),
      ...rawCalls(read('main.ts'), /webContents\.send\(\s*['"`]/),
      ...rawCalls(read('preload.ts'), /ipcRenderer\.(?:invoke|on|once|removeListener)\(\s*['"`]/),
    ]
    expect(violations).toEqual([])
  })

  it('keeps the shared registry free of the Effect runtime', () => {
    // preload.ts loads this file; anything it value-imports lands in the preload
    // bundle, and Effect is ESM-only.
    expect(read('ipc.ts')).not.toMatch(/from 'effect'/)
  })

  it('registers every channel through the decoding wrapper', () => {
    // One raw `ipcMain.handle` is the wrapper itself; a second would skip decode.
    expect(rawCalls(read('main.ts'), /ipcMain\.handle\(/)).toHaveLength(1)
  })

  it('keeps every argument row on a declared channel', () => {
    const declared = new Set<string>(Object.values(INVOKE))
    for (const channel of Object.keys(ARGS)) expect(declared.has(channel)).toBe(true)
  })

  it('decodes a valid call and rejects a malformed one at the seam', () => {
    expect(decodeArgs(INVOKE.moveTrack, ['track.mp3', 'music'])).toEqual(['track.mp3', 'music'])
    expect(() => decodeArgs(INVOKE.moveTrack, ['track.mp3', 'shelf'])).toThrow()
    expect(() => decodeArgs(INVOKE.setSttLanguage, [42])).toThrow()
    // A channel with no arguments passes through untouched.
    expect(decodeArgs(INVOKE.sttStart, [])).toEqual([])
  })

  it('decodes a context patch without inventing fields', () => {
    const [patch] = decodeArgs(INVOKE.setContext, [{ hintChars: 0, bogus: true }])
    expect(patch).toEqual({ hintChars: 0 })
    expect(mergeContext(DEFAULT_CONTEXT, patch).hintChars).toBe(0)
    // The renderer is a hint, not the authority: main clamps what arrives.
    const [absurd] = decodeArgs(INVOKE.setContext, [{ hintChars: 1e9 }])
    expect(mergeContext(DEFAULT_CONTEXT, absurd).hintChars).toBe(CONTEXT_LIMITS.hintChars[1])
  })
})
