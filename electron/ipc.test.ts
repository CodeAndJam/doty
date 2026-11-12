import fs from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EVENTS, INVOKE } from './ipc'

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
})
