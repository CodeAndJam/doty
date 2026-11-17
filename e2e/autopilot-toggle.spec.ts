/**
 * E2E: the autopilot master switch, which lives in the header.
 *
 *   1. a fresh profile has it OFF — Doty changes nothing on its own until asked
 *   2. turning it on reaches the music panel (the AUTO chip appears) and is
 *      written to the profile's config, not just to the renderer
 *   3. the choice survives a relaunch, both on and off again
 *
 * `config.json` is read directly as well: a switch that only moved renderer
 * state would look correct for one session and be forgotten by the next.
 *
 * No model, microphone or library is needed.
 *
 * Run with `pnpm build && npx playwright test e2e/autopilot-toggle.spec.ts --reporter=line`.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface Harness {
  profile: string
  profileDir: string
  root: string
}

function harness(): Harness {
  const profile = `autopilot-e2e-${process.pid}-${test.info().testId}`.replace(/[^a-zA-Z0-9_-]+/g, '-')
  const root = fs.mkdtempSync(join(tmpdir(), 'doty-autopilot-'))
  return { profile, profileDir: join(process.env.HOME ?? '', '.doty', 'profiles', profile), root }
}

function cleanup(h: Harness) {
  fs.rmSync(h.root, { recursive: true, force: true })
  fs.rmSync(h.profileDir, { recursive: true, force: true })
}

/** The persisted switch, or undefined when the profile has never written it. */
function persisted(h: Harness): boolean | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(join(h.profileDir, 'electron', 'config.json'), 'utf-8'))
    return raw.autopilotEnabled
  } catch {
    return undefined
  }
}

async function openApp(h: Harness, profile = h.profile): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, DOTY_PROFILE: profile },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const skip = page.getByText('Skip for now — set it up later in Settings')
  if (await skip.isVisible().catch(() => false)) await skip.click()
  return { app, page }
}

async function close(app: ElectronApplication) {
  await app.evaluate(({ app: electronApp }) => {
    setTimeout(() => electronApp.quit(), 50)
  })
  await app.close().catch(() => {})
}

test('off on a fresh profile, on after one click, and remembered across relaunches', async () => {
  const h = harness()
  const toggle = (page: Page) => page.getByTestId('autopilot-toggle')
  let app: ElectronApplication | undefined

  try {
    let opened = await openApp(h)
    app = opened.app
    let page = opened.page

    await expect(toggle(page)).toHaveText(/OFF/, { timeout: 15_000 })
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
    // Nothing has been asked for, so nothing may act: the panel's AUTO chip is
    // the only visible consequence of the switch being on.
    await expect(page.getByTestId('autopilot-chip')).toHaveCount(0)

    await toggle(page).click()
    await expect(toggle(page)).toHaveText(/ON/)
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('autopilot-chip')).toBeVisible()
    expect(persisted(h)).toBe(true)
    await close(app)
    app = undefined

    // Same profile, new process: the DM should not have to ask twice.
    opened = await openApp(h)
    app = opened.app
    page = opened.page
    await expect(toggle(page)).toHaveText(/ON/, { timeout: 15_000 })
    await expect(page.getByTestId('autopilot-chip')).toBeVisible()

    // And off sticks the same way.
    await toggle(page).click()
    await expect(toggle(page)).toHaveText(/OFF/)
    expect(persisted(h)).toBe(false)
    await close(app)
    app = undefined

    opened = await openApp(h)
    app = opened.app
    await expect(toggle(opened.page)).toHaveText(/OFF/, { timeout: 15_000 })
    await expect(opened.page.getByTestId('autopilot-chip')).toHaveCount(0)
  } finally {
    if (app) await close(app)
    cleanup(h)
  }
})
