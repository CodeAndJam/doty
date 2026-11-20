import fs from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// A config with one wrong-typed field is not a corrupt file: the rest of the
// settings must survive, and the file must not be quarantined.
const mock = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', async () => {
  const nodeFs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  mock.dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'doty-store-fields-'))
  return { app: { getPath: () => mock.dir, setPath: () => {} } }
})

let store: typeof import('./store').store

beforeAll(async () => {
  delete process.env.DOTY_PROFILE
  store = (await import('./store')).store
  fs.writeFileSync(
    join(mock.dir, 'config.json'),
    JSON.stringify({ musicFolder: '/music', recommendationCount: 'seven', autopilotEnabled: true }),
    'utf-8',
  )
})

afterAll(() => {
  fs.rmSync(mock.dir, { recursive: true, force: true })
})

describe('a config with one wrong-typed field', () => {
  it('keeps every value that decodes, and drops only the bad key', () => {
    expect(store.get('musicFolder', '')).toBe('/music')
    expect(store.get('autopilotEnabled', false)).toBe(true)
    expect(store.get('recommendationCount', 5)).toBe(5)
    expect(fs.readdirSync(mock.dir).filter((name) => name.includes('.corrupt-'))).toEqual([])
  })

  it('writes the good keys back on the next set', () => {
    store.set('recommendationCount', 9)
    const raw = JSON.parse(fs.readFileSync(join(mock.dir, 'config.json'), 'utf-8'))
    expect(raw).toEqual({ musicFolder: '/music', autopilotEnabled: true, recommendationCount: 9 })
    // The config holds tokens: it must not be world-readable.
    expect(fs.statSync(join(mock.dir, 'config.json')).mode & 0o077).toBe(0)
  })
})
