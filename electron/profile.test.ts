import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ setPath: vi.fn() }))

vi.mock('electron', () => ({
  app: { getPath: () => '/default/userData', setPath: mocks.setPath },
}))

async function loadProfile() {
  vi.resetModules()
  return import('./profile')
}

describe('DOTY_PROFILE', () => {
  const original = process.env.DOTY_PROFILE

  beforeEach(() => {
    delete process.env.DOTY_PROFILE
    mocks.setPath.mockClear()
  })

  afterEach(() => {
    if (original === undefined) delete process.env.DOTY_PROFILE
    else process.env.DOTY_PROFILE = original
  })

  it('keeps the normal install paths when unset', async () => {
    const profile = await loadProfile()

    expect(profile.PROFILE).toBe('')
    expect(profile.DOTY_HOME).toBe(path.join(os.homedir(), '.doty'))
    expect(profile.USER_DATA_DIR).toBe('/default/userData')
    expect(mocks.setPath).not.toHaveBeenCalled()
  })

  it('gives a named profile its own home and Electron user data', async () => {
    process.env.DOTY_PROFILE = 'My Branch 2'
    const profile = await loadProfile()

    expect(profile.PROFILE).toBe('My-Branch-2')
    expect(profile.DOTY_HOME).toBe(path.join(os.homedir(), '.doty', 'profiles', 'My-Branch-2'))
    expect(mocks.setPath).toHaveBeenCalledWith('userData', path.join(profile.DOTY_HOME, 'electron'))
  })

  it('strips path separators so a profile cannot escape ~/.doty', async () => {
    process.env.DOTY_PROFILE = '../../etc'
    const profile = await loadProfile()

    expect(profile.DOTY_HOME).toBe(path.join(os.homedir(), '.doty', 'profiles', 'etc'))
  })
})
