import fs from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// The store derives its path from Electron's userData; point that at a temp dir
// so a test never touches the DM's real config.
const mock = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', async () => {
  const nodeFs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  mock.dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'doty-store-'))
  return { app: { getPath: () => mock.dir, setPath: () => {} } }
})

let store: typeof import('./store').store

beforeAll(async () => {
  delete process.env.DOTY_PROFILE
  store = (await import('./store')).store
})

afterAll(() => {
  fs.rmSync(mock.dir, { recursive: true, force: true })
})

describe('autopilot master switch', () => {
  it('is absent until asked for, so the app reads it as off', () => {
    expect(store.get('autopilotEnabled', false)).toBe(false)
  })

  it('survives later writes, so the DM choice outlives the app', () => {
    const file = `${mock.dir}/config.json`

    store.set('autopilotEnabled', true)
    store.set('recommendationCount', 7)

    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(raw.autopilotEnabled).toBe(true)
    expect(raw.recommendationCount).toBe(7)
  })
})
