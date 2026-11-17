/**
 * E2E: naming a session from the transcript header.
 *
 *   1. `+` opens an in-app field; Enter keeps the typed name, Escape keeps the
 *      suggested default, and either way a session exists and is active
 *   2. a rename made through the header survives a relaunch of the same profile
 *   3. Escape during a rename puts the old name back and leaves the VTT alone
 *   4. an in-progress rename does not follow the DM to another session
 *
 * Separate file from lane-badge because it is a different slice: a session-name
 * failure should not read as a lane-badge failure. Each test still gets its own
 * `DOTY_PROFILE` and temp folder, so the DM's real profile, sessions and
 * library are never touched. No model and no microphone are needed.
 *
 * Run with `pnpm build && npx playwright test e2e/session-naming.spec.ts --reporter=line`.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The accent the session list paints on the active row. */
const ACTIVE = 'rgb(200, 146, 42)'

interface Harness {
  profile: string
  profileDir: string
  root: string
}

/** A fresh database, Electron profile and sessions folder per test. */
function harness(): Harness {
  const profile = `session-e2e-${process.pid}-${test.info().testId}`.replace(/[^a-zA-Z0-9_-]+/g, '-')
  const root = fs.mkdtempSync(join(tmpdir(), 'doty-session-'))
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

/** Bypass the STT onboarding wall — naming a session needs no model. */
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
  // The header shows "No Session" until the startup session is loaded.
  await expect(page.getByTestId('session-name')).not.toHaveText('No Session', { timeout: 15_000 })
  return { app, page }
}

function sessionDir(h: Harness): string {
  return join(h.profileDir, 'sessions')
}

/** Every session VTT, so a rename that only reaches the renderer is still caught. */
function sessionFiles(h: Harness): Record<string, string> {
  const dir = sessionDir(h)
  if (!fs.existsSync(dir)) return {}
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.vtt'))
  return Object.fromEntries(files.map((f) => [join(dir, f), fs.readFileSync(join(dir, f), 'utf-8')]))
}

/** The name in a session's NOTE block, exactly as the app would read it back. */
function readName(vtt: string): string {
  return /^Name: (.*)$/m.exec(vtt)?.[1] ?? ''
}

function names(h: Harness): string[] {
  return Object.values(sessionFiles(h)).map(readName)
}

function fileNamed(h: Harness, name: string): string | undefined {
  return Object.entries(sessionFiles(h)).find(([, vtt]) => readName(vtt) === name)?.[0]
}

/** The row the session list paints as active (it is the open dropdown's accent). */
async function activeRow(page: Page): Promise<string[]> {
  await page.getByTestId('session-list-toggle').click()
  const names = await page
    .locator('[data-session-dropdown] button.flex-1')
    .evaluateAll(
      (els, active) =>
        els.filter((el) => getComputedStyle(el).color === active).map((el) => (el.textContent ?? '').trim()),
      ACTIVE,
    )
  await page.getByTestId('session-list-toggle').click()
  return names
}

test('Enter keeps the typed name, Escape keeps the suggested default, both are active', async () => {
  const h = harness()
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))
    const name = page.getByTestId('session-name')
    const input = page.getByTestId('session-name-input')

    // Enter: the typed name wins, and it is the name on disk and in the header.
    await page.getByTestId('new-session').click()
    await expect(input).toBeVisible()
    const suggested = await input.inputValue()
    expect(suggested).toMatch(/^Session .+ \d{1,2}:\d{2}$/)
    await input.fill('A3 Enter Session')
    await input.press('Enter')
    await expect(input).toHaveCount(0)
    await expect(name).toHaveText('A3 Enter Session')
    await expect.poll(() => names(h)).toContain('A3 Enter Session')
    // ...and the new session is the active one, not the startup session.
    expect(await activeRow(page)).toEqual(['A3 Enter Session'])

    // Escape: a session is still created, with the suggested default.
    const before = names(h).length
    await page.getByTestId('new-session').click()
    const defaulted = await input.inputValue()
    await input.press('Escape')
    await expect(input).toHaveCount(0)
    await expect(name).toHaveText(defaulted)
    await expect.poll(() => names(h)).toHaveLength(before + 1)
    expect(names(h)).toContain(defaulted)
    expect(await activeRow(page)).toEqual([defaulted])
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})

test('a rename made in the header survives a relaunch of the same profile', async () => {
  const h = harness()
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))

    await page.getByTestId('new-session').click()
    await page.getByTestId('session-name-input').fill('Before Relaunch')
    await page.getByTestId('session-name-input').press('Enter')
    const name = page.getByTestId('session-name')
    await expect(name).toHaveText('Before Relaunch')
    await expect.poll(() => names(h)).toContain('Before Relaunch')

    // The header itself is the rename affordance: no prompt, no dialog.
    await name.click()
    const input = page.getByTestId('session-name-input')
    await expect(input).toHaveValue('Before Relaunch')
    await input.fill('Renamed A3')
    await input.press('Enter')
    await expect(name).toHaveText('Renamed A3')
    await expect.poll(() => names(h)).toContain('Renamed A3')

    await gracefulClose(app)
    app = undefined
    ;({ app, page } = await openApp(h))
    await expect(page.getByTestId('session-name')).toHaveText('Renamed A3')
    expect(names(h)).toContain('Renamed A3')
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})

test('Escape during a rename reverts the name and leaves the VTT note alone', async () => {
  const h = harness()
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))
    const name = page.getByTestId('session-name')
    const input = page.getByTestId('session-name-input')

    await name.click()
    await input.fill('Stable Name')
    await input.press('Enter')
    await expect(name).toHaveText('Stable Name')
    await expect.poll(() => names(h)).toContain('Stable Name')
    const before = sessionFiles(h)

    await name.click()
    await expect(input).toHaveValue('Stable Name')
    await input.fill('Reverted Away')
    await input.press('Escape')

    await expect(input).toHaveCount(0)
    await expect(name).toHaveText('Stable Name')
    // No save may land after the revert: give a stray blur-save its chance to fire.
    await page.waitForTimeout(500)
    expect(names(h)).toContain('Stable Name')
    expect(names(h)).not.toContain('Reverted Away')
    expect(sessionFiles(h)).toEqual(before)
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})

test('an in-progress rename does not follow the DM to another session', async () => {
  const h = harness()
  let app: ElectronApplication | undefined
  try {
    let page: Page
    ;({ app, page } = await openApp(h))
    const name = page.getByTestId('session-name')
    const input = page.getByTestId('session-name-input')

    for (const session of ['Session Alpha', 'Session Beta']) {
      await page.getByTestId('new-session').click()
      await input.fill(session)
      await input.press('Enter')
      await expect(name).toHaveText(session)
    }
    await expect.poll(() => names(h)).toEqual(expect.arrayContaining(['Session Alpha', 'Session Beta']))
    const alphaFile = fileNamed(h, 'Session Alpha')!
    const alphaBefore = fs.readFileSync(alphaFile, 'utf-8')

    // Start renaming Beta, then switch to Alpha. Leaving the field blurs it (and
    // saves to Beta), so the switch can never apply it to Alpha.
    await name.click()
    await input.fill('Draft For Beta')
    await input.press('Tab')
    await expect(input).toHaveCount(0)
    await page.getByTestId('session-list-toggle').click()
    await page.getByRole('button', { name: 'Session Alpha', exact: true }).click()

    await expect(name).toHaveText('Session Alpha')
    await expect(page.getByTestId('session-name-input')).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(fs.readFileSync(alphaFile, 'utf-8')).toBe(alphaBefore)
    expect(readName(fs.readFileSync(alphaFile, 'utf-8'))).toBe('Session Alpha')
  } finally {
    if (app) await gracefulClose(app)
    cleanup(h)
  }
})
