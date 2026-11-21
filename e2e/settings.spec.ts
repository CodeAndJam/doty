/**
 * E2E: Settings is a left rail with five groups, not one long scroll.
 *
 *   1. the gear opens a modal dialog whose tablist is exactly Audio, Library,
 *      Transcription, Director, Advanced
 *   2. each tab shows its own group and hides the other four
 *   3. the Library index line is meaningful with no embedding model (slice A2)
 *   4. Escape closes from inside the dialog and focus goes back to the gear
 *   5. arrows move the selected tab, and every tab's `aria-controls` names the
 *      rendered panel
 *   6. a half-typed Discord token survives a trip to another group — the panel
 *      is hidden, not unmounted
 *   7. closing and reopening lands on the gear's general group (Library)
 *   8. opening from the header's model-missing chip lands on Transcription
 *
 * Its own file: Settings is a different slice from lane badges or search, and a
 * rail regression should not read as a library failure. Each test gets its own
 * `DOTY_PROFILE` and temp folders; no model is downloaded and the DM's real
 * profile and library are never read or written.
 *
 * Run with `pnpm build && npx playwright test e2e/settings.spec.ts --reporter=line`.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type SectionId = 'audio' | 'library' | 'transcription' | 'director' | 'advanced'
const SECTIONS: SectionId[] = ['audio', 'library', 'transcription', 'director', 'updates', 'advanced']
const LABELS: Record<SectionId, string> = {
  audio: 'Audio',
  library: 'Library',
  transcription: 'Transcription',
  director: 'Director',
  updates: 'Updates',
  advanced: 'Advanced',
}

interface Harness {
  profile: string
  profileDir: string
  root: string
}

/** A fresh database, Electron profile and library per test. */
function harness(): Harness {
  const profile = `settings-e2e-${process.pid}-${test.info().testId}`.replace(/[^a-zA-Z0-9_-]+/g, '-')
  const root = fs.mkdtempSync(join(tmpdir(), 'doty-settings-'))
  fs.mkdirSync(join(root, 'music'), { recursive: true })
  fs.mkdirSync(join(root, 'sfx'), { recursive: true })
  return { profile, profileDir: join(process.env.HOME ?? '', '.doty', 'profiles', profile), root }
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

/** Bypass the STT onboarding wall — Settings needs no model. */
async function openApp(h: Harness): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, DOTY_TEST_PROFILE: '1', DOTY_PROFILE: h.profile },
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
  await page.evaluate(
    ([music, sfx]: string[]) => Promise.all([window.doty.setMusicFolder(music), window.doty.setSfxFolder(sfx)]),
    [join(h.root, 'music'), join(h.root, 'sfx')],
  )
  return { app, page }
}

/** The gear is the one header button whose icon rotates on hover. */
const gear = (page: Page): Locator => page.locator('header button:has([class*="rotate-45"])')
const dialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Settings' })
const panel = (page: Page, section: SectionId): Locator =>
  page.locator(`[role="tabpanel"]#settings-panel-${section}`)
const tab = (page: Page, section: SectionId): Locator => page.getByTestId(`settings-section-${section}`)

async function openSettings(page: Page) {
  await expect(gear(page)).toBeVisible()
  await gear(page).click()
  await expect(dialog(page)).toBeVisible()
}

/** One control that lives only in each group. */
function uniqueControl(page: Page, section: SectionId): Locator {
  const d = dialog(page)
  if (section === 'audio') return d.getByText('Crossfade', { exact: true })
  if (section === 'library') return d.getByTestId('index-summary')
  if (section === 'transcription') return d.getByText('Speech Recognition', { exact: true })
  if (section === 'director') return d.getByText('Autopilot Mode', { exact: true })
  if (section === 'updates') return d.getByRole('button', { name: 'Check for updates' })
  return d.getByTestId('debug-diagnostics')
}

async function activeElementId(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.id ?? '')
}

test('the gear opens one dialog whose rail is exactly the six groups', async () => {
  const h = harness()
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))
    await openSettings(page)

    expect(await dialog(page).getAttribute('aria-modal')).toBe('true')
    const tabs = dialog(page).getByRole('tab')
    await expect(tabs).toHaveCount(6)
    for (const section of SECTIONS) await expect(tab(page, section)).toHaveText(LABELS[section])

    // Each group is the only one on screen.
    for (const shown of SECTIONS) {
      await tab(page, shown).click()
      await expect(panel(page, shown)).toBeVisible()
      for (const other of SECTIONS) {
        const control = uniqueControl(page, other)
        if (other === shown) {
          await expect(control, `${other} should be visible on its own tab`).toBeVisible()
        } else {
          await expect(control, `${other} should be hidden on ${shown}`).toBeHidden()
        }
      }
    }

    // A2: what the index has done, said without a model installed.
    await tab(page, 'library').click()
    const summary = await dialog(page).getByTestId('index-summary').textContent()
    console.log('[e2e] index summary:', summary)
    expect(summary).toMatch(/not installed|\d+ of \d+ embedded/)
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})

test('arrows move the tab, Escape closes from inside, focus returns to the gear', async () => {
  const h = harness()
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))
    await openSettings(page)

    // Every tab declares a panel id; the selected one is the panel on screen.
    for (const section of SECTIONS) {
      expect(await tab(page, section).getAttribute('aria-controls')).toBe(`settings-panel-${section}`)
    }
    await tab(page, 'audio').click()
    await expect(panel(page, 'audio')).toBeVisible()
    expect(await tab(page, 'audio').getAttribute('aria-selected')).toBe('true')

    // ArrowDown walks the rail and takes focus with it.
    await tab(page, 'audio').focus()
    await page.keyboard.press('ArrowDown')
    await expect(tab(page, 'library')).toHaveAttribute('aria-selected', 'true')
    expect(await activeElementId(page)).toBe('settings-tab-library')
    await expect(panel(page, 'library')).toBeVisible()
    await expect(uniqueControl(page, 'library')).toBeVisible()

    // Home/End are part of the same roving-tabindex contract.
    await page.keyboard.press('End')
    await expect(tab(page, 'advanced')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Home')
    await expect(tab(page, 'audio')).toHaveAttribute('aria-selected', 'true')

    // Escape from the deepest focusable thing in the dialog still closes it.
    await tab(page, 'director').click()
    const token = dialog(page).getByPlaceholder('Bot token...')
    await token.focus()
    await expect.poll(() => token.evaluate((el) => el === document.activeElement)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect.poll(() => gear(page).evaluate((el) => el === document.activeElement)).toBe(true)
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})

test('a half-typed Discord token survives a group switch, and reopening starts at Library', async () => {
  const h = harness()
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))
    await openSettings(page)

    // The gear's general group.
    expect(await tab(page, 'library').getAttribute('aria-selected')).toBe('true')

    await tab(page, 'director').click()
    const token = dialog(page).getByPlaceholder('Bot token...')
    await token.fill('doty-e2e-marker-token')
    await expect(token).toHaveValue('doty-e2e-marker-token')

    // Director -> Library -> Director: hidden, not unmounted.
    await tab(page, 'library').click()
    await expect(token).toBeHidden()
    await tab(page, 'director').click()
    const kept = await token.inputValue()
    console.log('[e2e] token after round trip:', kept)
    expect(kept).toBe('doty-e2e-marker-token')

    // Close and reopen from the gear: back to the general group, not Director.
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await openSettings(page)
    await expect(tab(page, 'library')).toHaveAttribute('aria-selected', 'true')
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})

test('opening from the header model-missing chip lands on Transcription', async () => {
  const h = harness()
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))
    const chip = page.getByTitle('No speech model installed — open Settings to download one')
    await expect(chip).toBeVisible()
    console.log('[e2e] microphone permission:', await page.evaluate(() => window.doty.micCheckPermission()))
    await chip.click()
    await expect(dialog(page)).toBeVisible({ timeout: 10_000 })
    await expect(tab(page, 'transcription')).toHaveAttribute('aria-selected', 'true')
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})

test('a context budget is clamped by main, not by the panel', async () => {
  const h = harness()
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))

    // Straight through the seam, bypassing the slider: the IPC schema decodes
    // the patch, the store keeps it, and main normalises what it hands back.
    const saved = await page.evaluate(() => window.doty.setContext({ hintChars: 1e9 }))
    expect(saved.hintChars).toBe(1400)
    expect((await page.evaluate(() => window.doty.getContext())).hintChars).toBe(1400)

    // A key the schema does not know must not reach the store or reset a budget.
    const partial = await page.evaluate(() =>
      window.doty.setContext({ bogus: 1 } as unknown as { hintChars?: number }),
    )
    expect(partial.hintChars).toBe(1400)
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})
