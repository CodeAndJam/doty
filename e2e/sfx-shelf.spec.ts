/**
 * E2E: the effects shelf behaves like the music shelf.
 *
 * The setup is the DM's: one folder, no effects folder configured. Files the
 * lane rule calls effects (short clips) therefore live in the music folder, and
 * the effects pane is the only place they can be found.
 *
 *   1. the effects pane lists them
 *   2. the effects pane searches them by name, like the music pane does
 *   3. the suggestions fill the configured count, not only the effect that was
 *      played last — history is a boost, not the whole answer
 *
 * Isolated on purpose: its own `DOTY_PROFILE`, a temp `HOME` (no embedder, so no
 * download and the search answers by name) and a temp music folder.
 *
 * Run with `pnpm build && npx playwright test e2e/sfx-shelf.spec.ts --reporter=line`.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const FIXTURES_DIR = resolve(__dirname, 'fixtures')

/** Long enough to be music by duration, so the lane never depends on the scan. */
const MUSIC = ['Fantasy Tavern.mp3', 'The Desert.mp3']

/**
 * Short enough to be effects by duration (<= 20 s), which is the only evidence
 * the lane rule has before the audio pass runs. The names are what a DM would
 * search for, and every one of them lives in the music folder.
 */
const EFFECTS: Array<[copy: string, fixture: string]> = [
  // The `sfx` marker resolves the lane from the name, so the shelf appears before
  // a slow analysis finishes; the point is that a music-folder effect is listed.
  ['SFX - Massive Creature Roar.mp3', 'Massive Creature Roar.mp3'],
  ['SFX - Weather - Heavy Rain.mp3', 'Weather - Thunder Crash 1.mp3'],
  ['SFX - Weather - Light Wind.mp3', 'Massive Creature Roar.mp3'],
  ['SFX - Weather - Powerful Wind.mp3', 'Massive Creature Roar.mp3'],
  ['Campfire.mp3', 'Walking on Snow in Platemail.mp3'],
]

/** The configured number of suggestions. */
const SUGGESTIONS = 5

const NO_MODEL = 'by name — no embedding model'

interface Harness {
  home: string
  profile: string
  music: string
  root: string
}

function harness(): Harness {
  const profile = `shelf-e2e-${process.pid}-${test.info().testId}`.replace(/[^a-zA-Z0-9_-]+/g, '-')
  const root = fs.mkdtempSync(join(tmpdir(), 'doty-shelf-'))
  const home = join(root, 'home')
  const music = join(root, 'music')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(music, { recursive: true })
  for (const name of MUSIC) fs.copyFileSync(join(FIXTURES_DIR, name), join(music, name))
  for (const [name, fixture] of EFFECTS) fs.copyFileSync(join(FIXTURES_DIR, fixture), join(music, name))
  return { home, music, profile, root }
}

function cleanup(h: Harness) {
  fs.rmSync(h.root, { recursive: true, force: true })
}

async function gracefulClose(app: ElectronApplication) {
  await app.evaluate(({ app: electronApp }) => {
    setTimeout(() => electronApp.quit(), 50)
  })
  await app.close()
}

async function openApp(h: Harness): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, DOTY_TEST_PROFILE: '1', HOME: h.home, DOTY_PROFILE: h.profile },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  page.on('pageerror', (err) => console.error('[renderer:error]', err.message))
  const skip = page.getByText('Skip for now — set it up later in Settings')
  // The first paint may land after domcontentloaded; a one-shot isVisible() misses
  // the onboarding button on a loaded machine and the test then waits on a covered UI.
  await Promise.race([
    skip.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
    page.getByTestId('dm-input').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
  ])
  if (await skip.isVisible().catch(() => false)) await skip.click()
  // One folder only: no effects folder is configured, exactly like the DM's setup.
  await page.evaluate((music: string) => window.doty.setMusicFolder(music), h.music)
  return { app, page }
}

async function searchBox(page: Page, which: 'tracks' | 'effects') {
  return page.getByPlaceholder(which === 'tracks' ? 'Search the library' : 'Search effects')
}

async function openBrowse(page: Page, which: 'tracks' | 'effects') {
  await page.getByTitle(which === 'tracks' ? 'Browse all tracks' : 'Browse all effects').click()
  await expect(await searchBox(page, which)).toBeVisible()
}

/** The open panel, two levels above its search box. */
async function panel(page: Page, which: 'tracks' | 'effects') {
  return (await searchBox(page, which)).locator('xpath=../..')
}

/** One per row on the music shelf, one per card on the effects shelf. */
async function rows(page: Page, which: 'tracks' | 'effects') {
  return (await panel(page, which)).getByTestId('lane-badge')
}

test('the effects pane lists the music folder effects and searches them', async () => {
  const h = harness()
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))

    // 1. The effects that live in the music folder are on the effects shelf.
    await openBrowse(page, 'effects')
    const badges = await rows(page, 'effects')
    await expect(badges).toHaveCount(EFFECTS.length, { timeout: 60_000 })

    // 2. The pane finds them by name. It answered nothing for "Wind" before: the
    //    pool was the (unset) effects folder, not the shelf it lists.
    const box = await searchBox(page, 'effects')
    await box.fill('Wind')
    // Wait for the answer itself before counting rows: on a loaded machine the
    // first query also waits behind the index status read.
    await expect(page.getByTestId('search-mode')).toHaveText(NO_MODEL, { timeout: 30_000 })
    await expect(badges).toHaveCount(2, { timeout: 10_000 })
    await box.fill('Rain')
    await expect(badges).toHaveCount(1, { timeout: 10_000 })
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})

test('the suggestions fill the configured count, not just the one played effect', async () => {
  const h = harness()
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))

    // One effect is played, so recommendation history is no longer empty.
    await openBrowse(page, 'effects')
    const badges = await rows(page, 'effects')
    await expect(badges).toHaveCount(EFFECTS.length, { timeout: 60_000 })
    await badges
      .first()
      .locator('xpath=ancestor::div[contains(@class,"relative group")]')
      .getByRole('button')
      .first()
      .click()
    await page.keyboard.press('Escape')

    // A restart asks for the default suggestions again, now with that history.
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // One played effect is a boost, not the whole column: this showed a single
    // card where five were configured.
    await expect(page.getByTestId('sfx-card')).toHaveCount(SUGGESTIONS, { timeout: 60_000 })
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})
