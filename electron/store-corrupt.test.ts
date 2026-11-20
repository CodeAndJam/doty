import fs from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// A corrupt config is only reachable on a fresh module: the store loads once.
const mock = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', async () => {
  const nodeFs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  mock.dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'doty-store-corrupt-'))
  return { app: { getPath: () => mock.dir, setPath: () => {} } }
})

let store: typeof import('./store').store

beforeAll(async () => {
  delete process.env.DOTY_PROFILE
  // Importing the store mocks Electron and fixes the profile directory; the
  // config is only read on first use, so the corrupt file can still be planted.
  store = (await import('./store')).store
  // Two real settings, then a byte that makes the file unparseable.
  fs.writeFileSync(join(mock.dir, 'config.json'), '{"autopilotEnabled": true, "recommendationCount": 7, ', 'utf-8')
})

afterAll(() => {
  fs.rmSync(mock.dir, { recursive: true, force: true })
})

describe('a config that cannot be read', () => {
  it('is kept aside instead of being treated as an empty one', () => {
    expect(store.get('recommendationCount', 5)).toBe(5)

    const backups = fs.readdirSync(mock.dir).filter((name) => name.startsWith('config.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(join(mock.dir, backups[0]), 'utf-8')).toContain('"recommendationCount": 7')
  })

  it('starts a clean file on the next write instead of truncating the old one', () => {
    store.set('recommendationCount', 9)
    const raw = JSON.parse(fs.readFileSync(join(mock.dir, 'config.json'), 'utf-8'))
    expect(raw).toEqual({ recommendationCount: 9 })
    // The unreadable keys are still in the backup, not lost with the overwrite.
    const backup = fs.readdirSync(mock.dir).find((name) => name.startsWith('config.json.corrupt-'))
    expect(fs.readFileSync(join(mock.dir, backup!), 'utf-8')).toContain('"autopilotEnabled": true')
  })
})
