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

describe('retired config keys', () => {
  it('drops autopilotEnabled on the next write and keeps everything else', () => {
    const file = `${mock.dir}/config.json`
    // What an older build left behind.
    fs.writeFileSync(file, JSON.stringify({ autopilotEnabled: false, autopilotConfidenceThreshold: 0.8 }))

    store.set('recommendationCount', 7)

    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(raw.autopilotEnabled).toBeUndefined()
    expect(raw.recommendationCount).toBe(7)
    expect(raw.autopilotConfidenceThreshold).toBe(0.8)
  })
})
