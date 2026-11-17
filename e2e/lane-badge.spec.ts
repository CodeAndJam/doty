/**
 * E2E: a track's lane is a label, not a folder.
 *
 *   1. both browse shelves show a lane badge on every row/card
 *   2. clicking it files the track on the other lane, and the row moves to the
 *      other shelf without the file moving on disk
 *   3. the label survives a relaunch (it lives in the database, not the renderer)
 *   4. an item filed where it already lives is not shown as "moved"
 *
 * Isolated on purpose: its own `DOTY_PROFILE`, a temp music folder and a temp
 * effects folder, so the run never reads or writes the DM's real library or
 * profile. No model is needed — lane resolution falls back to folder/name.
 *
 * Run with `pnpm build && npx playwright test e2e/lane-badge.spec.ts --reporter=line`.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const FIXTURES_DIR = resolve(__dirname, 'fixtures')
const MUSIC_TRACK = 'Fantasy Tavern.mp3' // 10 min: music by duration as well as by folder
const EFFECT_TRACK = 'Weather - Thunder Crash 1.mp3' // 18 s: an effect by duration

/** A fresh database and Electron profile, shared across the two launches. */
const PROFILE = `lane-e2e-${process.pid}-${Date.now()}`
const PROFILE_DIR = join(process.env.HOME ?? '', '.doty', 'profiles', PROFILE)

const ROOT = fs.mkdtempSync(join(tmpdir(), 'doty-lane-'))
const MUSIC_DIR = join(ROOT, 'music')
const SFX_DIR = join(ROOT, 'sfx')

async function gracefulClose(app: ElectronApplication) {
  await app.evaluate(({ app: electronApp }) => {
    setTimeout(() => electronApp.quit(), 50)
  })
  await app.close()
}

function launch() {
  return electron.launch({
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, DOTY_PROFILE: PROFILE },
  })
}

/** Bypass the STT onboarding wall: this test needs no model. */
async function openApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await launch()
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  page.on('pageerror', (err) => console.error('[renderer:error]', err.message))
  const skip = page.getByText('Skip for now — set it up later in Settings')
  if (await skip.isVisible().catch(() => false)) await skip.click()
  return { app, page }
}

/** Every lane badge on the open shelf, with how it is painted. */
async function badges(page: Page) {
  return page.getByTestId('lane-badge').evaluateAll((els) =>
    els.map((el) => ({
      text: (el.textContent ?? '').trim(),
      aria: el.getAttribute('aria-label') ?? '',
      // The "moved" highlight is the only border the badge ever gets.
      border: getComputedStyle(el).borderTopColor,
    })),
  )
}

/** Name, size and mtime of every file, so a disk move cannot hide. */
function disk(dir: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .map((rel) => {
      const stat = fs.statSync(join(dir, rel))
      return stat.isFile() ? `${rel}\t${stat.size}\t${stat.mtimeMs}` : ''
    })
    .filter(Boolean)
    .sort()
}

async function openBrowse(page: Page, which: 'tracks' | 'effects') {
  await page.getByTitle(which === 'tracks' ? 'Browse all tracks' : 'Browse all effects').click()
  await expect(page.getByPlaceholder(which === 'tracks' ? 'Search tracks or tags...' : 'Search effects...')).toBeVisible()
}

async function closeBrowse(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('lane-badge')).toHaveCount(0)
}

/** Narrow the open shelf to one item, so its badge is the only one. */
async function onlyRow(page: Page, which: 'tracks' | 'effects', name: string) {
  await page.getByPlaceholder(which === 'tracks' ? 'Search tracks or tags...' : 'Search effects...').fill(name)
  await expect(page.getByTestId('lane-badge')).toHaveCount(1)
  return page.getByTestId('lane-badge').first()
}

const NOT_MOVED = 'rgba(0, 0, 0, 0)'
const MOVED = 'rgba(200, 146, 42, 0.6)'

test('a lane badge files a track on the other shelf and the label survives a relaunch', async () => {
  fs.mkdirSync(MUSIC_DIR, { recursive: true })
  fs.mkdirSync(SFX_DIR, { recursive: true })
  fs.copyFileSync(join(FIXTURES_DIR, MUSIC_TRACK), join(MUSIC_DIR, MUSIC_TRACK))
  fs.copyFileSync(join(FIXTURES_DIR, EFFECT_TRACK), join(SFX_DIR, EFFECT_TRACK))
  const musicBefore = disk(MUSIC_DIR)
  const sfxBefore = disk(SFX_DIR)

  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp())

    await page.evaluate(
      ([music, sfx]: string[]) => Promise.all([window.doty.setMusicFolder(music), window.doty.setSfxFolder(sfx)]),
      [MUSIC_DIR, SFX_DIR],
    )

    // (a) a music row carries a badge, and a track filed where it lives is not "moved".
    await openBrowse(page, 'tracks')
    const musicBadge = await onlyRow(page, 'tracks', 'Fantasy Tavern')
    const asMusic = await badges(page)
    console.log('[e2e] music row badge:', asMusic)
    expect(asMusic[0].text).toBe('♪')
    expect(asMusic[0].aria).toContain('Filed as music')
    expect(asMusic[0].border).toBe(NOT_MOVED)
    void musicBadge

    // (a) an effects card carries a badge too, also where it lives.
    await closeBrowse(page)
    await openBrowse(page, 'effects')
    await onlyRow(page, 'effects', 'Thunder Crash')
    const asEffect = await badges(page)
    console.log('[e2e] effects card badge:', asEffect)
    expect(asEffect[0].text).toBe('FX')
    expect(asEffect[0].aria).toContain('Filed as an effect')
    expect(asEffect[0].border).toBe(NOT_MOVED)

    // (b) click it on the music row: filed as an effect, the row leaves the shelf.
    await closeBrowse(page)
    await openBrowse(page, 'tracks')
    await onlyRow(page, 'tracks', 'Fantasy Tavern')
    await page.getByTestId('lane-badge').first().click()
    await expect(page.getByTestId('lane-badge')).toHaveCount(0, { timeout: 15_000 })
    await closeBrowse(page)

    // ...and it shows up in the effects shelf, marked as moved.
    await openBrowse(page, 'effects')
    await onlyRow(page, 'effects', 'Fantasy Tavern')
    const moved = await badges(page)
    console.log('[e2e] moved effect badge:', moved)
    // The badge shows the resolved lane (an effect now) and the highlight shows
    // that it is not where its folder put it.
    expect(moved[0].text).toBe('FX')
    expect(moved[0].aria).toContain('Filed as an effect')
    expect(moved[0].border).toBe(MOVED)

    // (d) nothing on disk changed: same files, same sizes, same mtimes.
    expect(disk(MUSIC_DIR)).toEqual(musicBefore)
    expect(disk(SFX_DIR)).toEqual(sfxBefore)

    // (c) the label is a database row, so a relaunch still knows it.
    await closeBrowse(page)
    await gracefulClose(app)
    app = undefined
    ;({ app, page } = await openApp())
    await openBrowse(page, 'effects')
    await onlyRow(page, 'effects', 'Fantasy Tavern')
    const afterRelaunch = await badges(page)
    console.log('[e2e] after relaunch:', afterRelaunch)
    expect(afterRelaunch[0].text).toBe('FX')
    expect(afterRelaunch[0].border).toBe(MOVED)
  } finally {
    if (app) await gracefulClose(app)
    fs.rmSync(ROOT, { recursive: true, force: true })
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true })
  }
})
