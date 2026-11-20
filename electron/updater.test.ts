import { describe, expect, it } from 'vitest'
import { bundleFromExecutable, checkForUpdate, isNewer, parseVersion, pickDmg } from './updater'

describe('parseVersion', () => {
  it('reads a plain and a v-prefixed release', () => {
    expect(parseVersion('5.4.0')).toEqual([5, 4, 0])
    expect(parseVersion('v5.4.1')).toEqual([5, 4, 1])
  })

  it('ignores a prerelease suffix', () => {
    expect(parseVersion('5.4.0-beta.1')).toEqual([5, 4, 0])
  })

  it('refuses anything that is not semver', () => {
    expect(parseVersion('models-v1')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })
})

describe('isNewer', () => {
  it('compares numerically, not as text', () => {
    expect(isNewer('5.10.0', '5.9.0')).toBe(true)
    expect(isNewer('5.9.0', '5.10.0')).toBe(false)
  })

  it('never offers the running build or an older one', () => {
    expect(isNewer('5.4.0', '5.4.0')).toBe(false)
    expect(isNewer('5.3.9', '5.4.0')).toBe(false)
  })

  it('stays quiet when either side is unreadable', () => {
    expect(isNewer('models-v1', '5.4.0')).toBe(false)
    expect(isNewer('5.4.0', 'dev')).toBe(false)
  })
})

describe('pickDmg', () => {
  const assets = [
    { name: 'Doty-5.4.0-x64.dmg', browser_download_url: 'https://x/x64.dmg', size: 200 * 1024 * 1024 },
    { name: 'Doty-5.4.0-arm64.dmg', browser_download_url: 'https://x/arm64.dmg', size: 234 * 1024 * 1024 },
    { name: 'notes.txt', browser_download_url: 'https://x/notes.txt' },
  ]

  it('takes the DMG for this architecture', () => {
    expect(pickDmg(assets, 'arm64')).toEqual({ url: 'https://x/arm64.dmg', sizeMB: 234 })
  })

  it('accepts a lone DMG, so a Rosetta process still finds the arm64 build', () => {
    const arm64Only = assets.filter((a) => a.name.includes('arm64'))
    expect(pickDmg(arm64Only, 'x64')?.url).toBe('https://x/arm64.dmg')
  })

  it('refuses to guess between two DMGs that match no arch', () => {
    expect(pickDmg(assets, 'ia32')).toBeNull()
    expect(
      pickDmg(
        assets.filter((a) => a.name.endsWith('.txt')),
        'arm64',
      ),
    ).toBeNull()
  })
})

describe('bundleFromExecutable', () => {
  it('finds the .app above Contents/MacOS', () => {
    expect(bundleFromExecutable('/Applications/Doty.app/Contents/MacOS/Doty')).toBe('/Applications/Doty.app')
    expect(bundleFromExecutable('/Users/dm/doty/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')).toBe(
      '/Users/dm/doty/node_modules/electron/dist/Electron.app',
    )
  })

  it('returns null when there is no bundle to replace', () => {
    expect(bundleFromExecutable('/usr/local/bin/doty')).toBeNull()
  })
})

describe('checkForUpdate', () => {
  const release = {
    tag_name: 'v5.4.0',
    assets: [{ name: 'Doty-5.4.0-arm64.dmg', browser_download_url: 'https://x/arm64.dmg', size: 1024 }],
  }

  it('offers a newer release with its DMG', async () => {
    const found = await checkForUpdate('5.3.0', 'arm64', async () => [release])
    expect(found).toEqual({ version: '5.4.0', url: 'https://x/arm64.dmg', sizeMB: 0 })
  })

  it('offers nothing when this build is current', async () => {
    expect(await checkForUpdate('5.4.0', 'arm64', async () => [release])).toBeNull()
  })

  it('offers nothing for a release with no DMG attached', async () => {
    const empty = { tag_name: 'v5.4.0', assets: [] }
    expect(await checkForUpdate('5.3.0', 'arm64', async () => [empty])).toBeNull()
  })

  it('ignores a model bundle published after the app release', async () => {
    const models = { tag_name: 'models-v2', assets: [{ name: 'd1.tar.gz', browser_download_url: 'https://x/m' }] }
    expect(await checkForUpdate('5.3.0', 'arm64', async () => [models, release])).toEqual({
      version: '5.4.0',
      url: 'https://x/arm64.dmg',
      sizeMB: 0,
    })
  })

  it('never offers a draft or a prerelease', async () => {
    const draft = { ...release, draft: true }
    const prerelease = { ...release, tag_name: 'v5.5.0-rc.1', prerelease: true }
    expect(await checkForUpdate('5.3.0', 'arm64', async () => [draft, prerelease])).toBeNull()
  })
})
