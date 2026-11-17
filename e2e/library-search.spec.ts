/**
 * E2E: the browse panels search the library, and say how they answered.
 *
 *   1. a name in the music box leaves only its row; clearing restores the shelf
 *   2. the mode label appears with a query and goes with it, and without an
 *      embedding model it says so instead of pretending
 *   3. a row found by search still plays
 *   4. the effects box hides non-matching cards, and the selected category tab
 *      does not hide a match
 *   5. a second query replaces the first answer instead of leaving it behind
 *
 * Isolated on purpose: its own `DOTY_PROFILE`, a temp `HOME` (so `MODELS_DIR`
 * has no embedder and no download is ever attempted) and temp music/effects
 * folders. Nothing here reads or writes the DM's real profile or library.
 *
 * Why a second file next to lane-badge.spec.ts: that one owns the lane label and
 * copies two fixtures; this one needs eight fixtures, a model-free HOME and a
 * different shelf shape. Extending it would have carried both concerns.
 *
 * Run with `pnpm build && npx playwright test e2e/library-search.spec.ts --reporter=line`.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const FIXTURES_DIR = resolve(__dirname, 'fixtures')

/** Long enough to be music by duration, so the lane never depends on the scan. */
const MUSIC = ['Fantasy Tavern.mp3', 'The Desert.mp3', 'Spooky - Desna.mp3']
/** Short enough to be effects by duration (<= 20 s). Category = subfolder name. */
const EFFECTS: Array<[string, string]> = [
  ['nature', 'Weather - Thunder Crash 1.mp3'],
  ['footsteps', 'Walking on Snow in Platemail.mp3'],
  ['combat', 'Massive Creature Roar.mp3'],
]

const NO_MODEL = 'by name — no embedding model'

interface Harness {
  home: string
  profile: string
  profileDir: string
  root: string
  music: string
  sfx: string
}

/** A fresh database, Electron profile, HOME and library per test. */
function harness(): Harness {
  const profile = `search-e2e-${process.pid}-${test.info().testId}`.replace(/[^a-zA-Z0-9_-]+/g, '-')
  const root = fs.mkdtempSync(join(tmpdir(), 'doty-search-'))
  const home = join(root, 'home')
  const music = join(root, 'music')
  const sfx = join(root, 'sfx')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(music, { recursive: true })
  for (const name of MUSIC) fs.copyFileSync(join(FIXTURES_DIR, name), join(music, name))
  for (const [category, name] of EFFECTS) {
    fs.mkdirSync(join(sfx, category), { recursive: true })
    fs.copyFileSync(join(FIXTURES_DIR, name), join(sfx, category, name))
  }
  return { home, profile, profileDir: join(home, '.doty', 'profiles', profile), root, music, sfx }
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

/**
 * Launch with an empty HOME: `~/.doty/models` is then empty, so the app runs
 * without an embedding model and must fall back to text search. No download.
 */
async function openApp(h: Harness): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, HOME: h.home, DOTY_PROFILE: h.profile },
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

async function searchBox(page: Page, which: 'tracks' | 'effects') {
  return page.getByPlaceholder(which === 'tracks' ? 'Search the library' : 'Search effects')
}

async function openBrowse(page: Page, which: 'tracks' | 'effects') {
  await page.getByTitle(which === 'tracks' ? 'Browse all tracks' : 'Browse all effects').click()
  await expect(await searchBox(page, which)).toBeVisible()
}

/**
 * The open panel: its search box, two levels below the panel root. Scoping
 * matters — the soundboard behind it shows recommendation cards with the same
 * track names, so an unscoped text match is ambiguous.
 */
async function panel(page: Page, which: 'tracks' | 'effects') {
  return (await searchBox(page, which)).locator('xpath=../..')
}

/** One per row on the music shelf, one per card on the effects shelf. */
async function rows(page: Page, which: 'tracks' | 'effects') {
  return (await panel(page, which)).getByTestId('lane-badge')
}

/** The effects card that owns a badge. The active-channel strip repeats labels. */
function card(badge: Locator) {
  return badge.locator('xpath=ancestor::div[contains(@class,"relative group")]')
}

test('searching a name narrows the music shelf, clearing restores it, and the result plays', async () => {
  const h = harness()
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))
    await openBrowse(page, 'tracks')
    const box = await searchBox(page, 'tracks')
    const shelf = await panel(page, 'tracks')
    const badges = await rows(page, 'tracks')

    // The whole shelf, then only the named row.
    await expect(badges).toHaveCount(MUSIC.length, { timeout: 20_000 })
    await box.fill('Fantasy')
    await expect(badges).toHaveCount(1)
    await expect(shelf.getByText('Fantasy Tavern', { exact: true })).toBeVisible()
    await expect(shelf.getByText('Spooky - Desna', { exact: true })).toHaveCount(0)

    // How it answered, without a model: the fallback is named, not hidden.
    await expect(page.getByTestId('search-mode')).toHaveText(NO_MODEL)

    // Emptying the box is the shelf again, and no claim is left behind.
    await box.fill('')
    await expect(badges).toHaveCount(MUSIC.length)
    await expect(page.getByTestId('search-mode')).toHaveCount(0)

    // A row that came from search still plays: the player names it.
    await box.fill('Desna')
    await expect(badges).toHaveCount(1)
    const row = shelf.getByText('Spooky - Desna', { exact: true }).locator('..')
    await row.getByRole('button').first().click()
    await page.keyboard.press('Escape')
    await expect(badges).toHaveCount(0)
    await expect(page.getByRole('slider', { name: 'Seek' })).toBeVisible({ timeout: 15_000 })
    // The transport names what it is playing, no hover needed since the console
    // rewrite dropped the tooltip button this used to reach for. The queue lists
    // the same title, so the first match is the transport.
    await expect(page.getByTitle('Spooky - Desna').first()).toBeVisible()
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})

test('the effects search shows the matching card only, even under another category tab', async () => {
  const h = harness()
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))
    await openBrowse(page, 'effects')
    const box = await searchBox(page, 'effects')
    const shelf = await panel(page, 'effects')
    const badges = await rows(page, 'effects')
    await expect(badges).toHaveCount(EFFECTS.length, { timeout: 20_000 })

    // A tab for another category first: a tab is not a search filter.
    await (await panel(page, 'effects')).getByRole('button', { name: 'Combat', exact: true }).click()
    await expect(badges).toHaveCount(1)
    await box.fill('Thunder')
    await expect(badges).toHaveCount(1)
    const hit = card(badges.first())
    await expect(hit).toContainText('Thunder Crash')
    await expect(hit).not.toContainText('Platemail')
    await expect(hit).not.toContainText('Creature Roar')
    await expect(page.getByTestId('search-mode')).toHaveText(NO_MODEL)

    // Clearing goes back to the tab's own contents, not the whole shelf.
    await box.fill('')
    await expect(badges).toHaveCount(1)
    await expect(card(badges.first())).toContainText('Creature Roar')
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})

test('a second query replaces the first answer and the old rows do not come back', async () => {
  const h = harness()
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))
    await openBrowse(page, 'tracks')
    const box = await searchBox(page, 'tracks')
    const shelf = await panel(page, 'tracks')
    const badges = await rows(page, 'tracks')
    await expect(badges).toHaveCount(MUSIC.length, { timeout: 20_000 })

    // First answer on screen, then a second query typed right behind it.
    await box.fill('Fantasy')
    await expect(shelf.getByText('Fantasy Tavern', { exact: true })).toBeVisible()
    await box.fill('Desna')

    await expect(shelf.getByText('Spooky - Desna', { exact: true })).toBeVisible()
    await expect(badges).toHaveCount(1)
    await expect(shelf.getByText('Fantasy Tavern', { exact: true })).toHaveCount(0)
    // A late first answer must not paint the old row back over the new one.
    await page.waitForTimeout(700)
    await expect(shelf.getByText('Fantasy Tavern', { exact: true })).toHaveCount(0)
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})
