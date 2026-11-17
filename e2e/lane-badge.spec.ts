/**
 * E2E: a track's lane is a label, not a folder.
 *
 *   1. both browse shelves show a lane badge on every row/card
 *   2. clicking it files the track on the other lane, and the row moves to the
 *      other shelf without the file moving on disk
 *   3. the label survives a relaunch (it lives in the database, not the renderer)
 *   4. an item filed where it already lives is not shown as "moved"
 *
 * Isolated on purpose: each test gets its own `DOTY_PROFILE`, a temp music folder
 * and a temp effects folder, so a run never reads or writes the DM's real library
 * or profile. No model is needed — lane resolution falls back to folder/name.
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

/** The only border a badge ever gets is the "filed elsewhere" highlight. */
const NOT_MOVED = 'rgba(0, 0, 0, 0)'
const MOVED = 'rgba(200, 146, 42, 0.6)'

interface Harness {
  profile: string
  profileDir: string
  root: string
  music: string
  sfx: string
}

/** A fresh database, Electron profile and library per test. */
function harness(): Harness {
  const profile = `lane-e2e-${process.pid}-${test.info().testId}`.replace(/[^a-zA-Z0-9_-]+/g, '-')
  const root = fs.mkdtempSync(join(tmpdir(), 'doty-lane-'))
  const music = join(root, 'music')
  const sfx = join(root, 'sfx')
  fs.mkdirSync(music, { recursive: true })
  fs.mkdirSync(sfx, { recursive: true })
  fs.copyFileSync(join(FIXTURES_DIR, MUSIC_TRACK), join(music, MUSIC_TRACK))
  fs.copyFileSync(join(FIXTURES_DIR, EFFECT_TRACK), join(sfx, EFFECT_TRACK))
  return { profile, profileDir: join(process.env.HOME ?? '', '.doty', 'profiles', profile), root, music, sfx }
}

function cleanup(h: Harness) {
  fs.rmSync(h.root, { recursive: true, force: true })
  fs.rmSync(h.profileDir, { recursive: true, force: true })
}

async function gracefulClose(app: ElectronApplication) {
  await app.evaluate(({ app: electronApp }) => {
    setTimeout(() => electronApp.quit(), 50)
  })
  await app.close()
}

/** Bypass the STT onboarding wall — this test needs no model. */
async function openApp(h: Harness): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, DOTY_PROFILE: h.profile },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  page.on('pageerror', (err) => console.error('[renderer:error]', err.message))
  const skip = page.getByText('Skip for now — set it up later in Settings')
  if (await skip.isVisible().catch(() => false)) await skip.click()
  await page.evaluate(
    ([music, sfx]: string[]) => Promise.all([window.doty.setMusicFolder(music), window.doty.setSfxFolder(sfx)]),
    [h.music, h.sfx],
  )
  return { app, page }
}

/** Every lane badge on the open shelf, with how it is painted. */
async function badges(page: Page) {
  return page.getByTestId('lane-badge').evaluateAll((els) =>
    els.map((el) => ({
      text: (el.textContent ?? '').trim(),
      aria: el.getAttribute('aria-label') ?? '',
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

async function searchBox(page: Page, which: 'tracks' | 'effects') {
  return page.getByPlaceholder(which === 'tracks' ? 'Search tracks or tags...' : 'Search effects...')
}

async function openBrowse(page: Page, which: 'tracks' | 'effects') {
  await page.getByTitle(which === 'tracks' ? 'Browse all tracks' : 'Browse all effects').click()
  await expect(await searchBox(page, which)).toBeVisible()
}

async function closeBrowse(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('lane-badge')).toHaveCount(0)
}

/** Narrow the open shelf to one item, so its badge is the only one. */
async function onlyRow(page: Page, which: 'tracks' | 'effects', name: string) {
  await (await searchBox(page, which)).fill(name)
  await expect(page.getByTestId('lane-badge')).toHaveCount(1)
}

test('a music track filed as an effect moves shelf and its label survives a relaunch', async () => {
  const h = harness()
  const musicBefore = disk(h.music)
  const sfxBefore = disk(h.sfx)
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))

    // (a) a music row carries a badge, and a track filed where it lives is not "moved".
    await openBrowse(page, 'tracks')
    await onlyRow(page, 'tracks', 'Fantasy Tavern')
    const [asMusic] = await badges(page)
    console.log('[e2e] music row badge:', asMusic)
    expect(asMusic.text).toBe('♪')
    expect(asMusic.aria).toContain('Filed as music')
    expect(asMusic.border).toBe(NOT_MOVED)

    // (a) an effects card carries a badge too, also where it lives.
    await closeBrowse(page)
    await openBrowse(page, 'effects')
    await onlyRow(page, 'effects', 'Thunder Crash')
    const [asEffect] = await badges(page)
    console.log('[e2e] effects card badge:', asEffect)
    expect(asEffect.text).toBe('FX')
    expect(asEffect.aria).toContain('Filed as an effect')
    expect(asEffect.border).toBe(NOT_MOVED)

    // (b) click it on the music row: filed as an effect, the row leaves the shelf.
    await closeBrowse(page)
    await openBrowse(page, 'tracks')
    await onlyRow(page, 'tracks', 'Fantasy Tavern')
    await page.getByTestId('lane-badge').click()
    await expect(page.getByTestId('lane-badge')).toHaveCount(0, { timeout: 15_000 })
    await closeBrowse(page)

    // ...and it shows up in the effects shelf, wearing the "filed elsewhere" highlight.
    await openBrowse(page, 'effects')
    await onlyRow(page, 'effects', 'Fantasy Tavern')
    const [moved] = await badges(page)
    console.log('[e2e] moved effect badge:', moved)
    expect(moved.text).toBe('FX')
    expect(moved.aria).toContain('Filed as an effect')
    expect(moved.border).toBe(MOVED)

    // (d) nothing on disk changed: same files, same sizes, same mtimes.
    expect(disk(h.music)).toEqual(musicBefore)
    expect(disk(h.sfx)).toEqual(sfxBefore)

    // (c) the label is a database row, so a relaunch still knows it.
    await closeBrowse(page)
    await gracefulClose(app)
    app = undefined
    ;({ app, page } = await openApp(h))
    await openBrowse(page, 'effects')
    await onlyRow(page, 'effects', 'Fantasy Tavern')
    const [afterRelaunch] = await badges(page)
    console.log('[e2e] after relaunch:', afterRelaunch)
    expect(afterRelaunch.text).toBe('FX')
    expect(afterRelaunch.border).toBe(MOVED)
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})

test('an effect filed as music moves to the music shelf and back, losing the highlight', async () => {
  const h = harness()
  const musicBefore = disk(h.music)
  const sfxBefore = disk(h.sfx)
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))

    await openBrowse(page, 'effects')
    await onlyRow(page, 'effects', 'Thunder Crash')
    expect((await badges(page))[0].border).toBe(NOT_MOVED)
    await page.getByTestId('lane-badge').click()
    await expect(page.getByTestId('lane-badge')).toHaveCount(0, { timeout: 15_000 })
    await closeBrowse(page)

    // The music shelf addresses it by absolute path: a different branch of listMusic.
    await openBrowse(page, 'tracks')
    await onlyRow(page, 'tracks', 'Thunder Crash')
    const [asMusic] = await badges(page)
    console.log('[e2e] effect filed as music:', asMusic)
    expect(asMusic.text).toBe('♪')
    expect(asMusic.aria).toContain('Filed as music')
    expect(asMusic.border).toBe(MOVED)
    expect(disk(h.music)).toEqual(musicBefore)
    expect(disk(h.sfx)).toEqual(sfxBefore)

    // Clicking again picks the folder's own lane, which drops the override: no highlight.
    await page.getByTestId('lane-badge').click()
    await expect(page.getByTestId('lane-badge')).toHaveCount(0, { timeout: 15_000 })
    await closeBrowse(page)
    await openBrowse(page, 'effects')
    await onlyRow(page, 'effects', 'Thunder Crash')
    const [back] = await badges(page)
    console.log('[e2e] filed back as an effect:', back)
    expect(back.text).toBe('FX')
    expect(back.border).toBe(NOT_MOVED)
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})
