import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDebugLogger } from './logger'

// logger.ts pulls its default path through profile.ts, which asks Electron for
// userData. A temp dir keeps the DM's real profile untouched.
vi.mock('electron', () => {
  const userData = join(tmpdir(), 'doty-logger-test-electron')
  return { app: { getPath: () => userData, setPath: () => {} } }
})

let dir = ''

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), 'doty-logger-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const file = () => join(dir, 'logs', 'doty.log')

describe('debug logger', () => {
  it('writes nothing until debug mode is on', () => {
    const logger = createDebugLogger(file())
    logger.write('log', ['before'])
    expect(fs.existsSync(file())).toBe(false)

    logger.setEnabled(true)
    logger.write('warn', ['after', { n: 1 }])

    const text = fs.readFileSync(file(), 'utf8')
    expect(text).not.toContain('before')
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}T.* warn after \{ n: 1 \}/)
  })

  it('stops writing when debug mode is turned off', () => {
    const logger = createDebugLogger(file())
    logger.setEnabled(true)
    logger.write('log', ['kept'])
    logger.setEnabled(false)
    logger.write('log', ['dropped'])

    const text = fs.readFileSync(file(), 'utf8')
    expect(text).toContain('kept')
    expect(text).not.toContain('dropped')
  })

  it('returns the most recent lines, oldest first', () => {
    const logger = createDebugLogger(file())
    logger.setEnabled(true)
    for (const n of [1, 2, 3, 4, 5]) logger.write('log', [`line-${n}`])

    const tail = logger.tail(2).split('\n')
    expect(tail).toHaveLength(2)
    expect(tail[0]).toContain('line-4')
    expect(tail[1]).toContain('line-5')
  })

  it('reports an empty tail before anything was written', () => {
    expect(createDebugLogger(file()).tail()).toBe('')
  })

  it('rotates an oversized log instead of growing without bound', () => {
    fs.mkdirSync(join(dir, 'logs'), { recursive: true })
    fs.writeFileSync(file(), 'x'.repeat(2 * 1024 * 1024 + 1))

    const logger = createDebugLogger(file())
    logger.setEnabled(true)

    expect(fs.statSync(`${file()}.1`).size).toBeGreaterThan(2 * 1024 * 1024)
    expect(fs.statSync(file()).size).toBeLessThan(4096)
  })

  it('ensure creates the file so the viewer can open it', () => {
    const logger = createDebugLogger(file())
    logger.ensure()
    expect(fs.existsSync(file())).toBe(true)
  })
})
