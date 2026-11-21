/**
 * E2E: a track dropped into the folder while the app is running.
 *
 * The DM should not have to re-pick the folder or relaunch Doty: the watcher
 * sees the file, the scanner measures it, and once the scan settles the library
 * is rebuilt — lane, seconds and all. This is the flow that decides whether a
 * freshly downloaded roar is offered tonight or after a restart.
 *
 * The second file is an effect by duration and there is no effects folder, so it
 * must still appear in the music panel: it has nowhere else to go.
 *
 * Run with `pnpm build && npx playwright test e2e/library-watch.spec.ts --reporter=line`.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const FIXTURES = resolve(__dirname, 'fixtures')
const CUE = 'Fantasy Tavern.mp3' // 10 min: a cue
const LATE = 'Weather - Thunder Crash 1.mp3' // 18 s: an effect

test('a file added while the app runs becomes a labelled, measured track', async () => {
  const profile = `watch-e2e-${process.pid}-${test.info().testId}`.replace(/[^a-zA-Z0-9_-]+/g, '-')
  const root = fs.mkdtempSync(join(tmpdir(), 'doty-watch-'))
  const music = join(root, 'music')
  fs.mkdirSync(music, { recursive: true })
  fs.copyFileSync(join(FIXTURES, CUE), join(music, CUE))

  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, DOTY_TEST_PROFILE: '1', DOTY_PROFILE: profile, DOTY_E2E_HIDE_WINDOW: '1' },
    })
    const page: Page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const skip = page.getByText('Skip for now — set it up later in Settings')
    // The first paint may land after domcontentloaded; a one-shot isVisible() misses
    // the onboarding button on a loaded machine and the test then waits on a covered UI.
    await Promise.race([
      skip.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
      page.getByTestId('dm-input').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
    ])
    if (await skip.isVisible().catch(() => false)) await skip.click()

    await page.evaluate((dir: string) => window.doty.setMusicFolder(dir), music)
    await expect
      .poll(async () => Math.round((await page.evaluate(() => window.doty.getAllMetadata()))[CUE]?.duration ?? 0), {
        timeout: 120_000,
        intervals: [500, 1000, 2000],
      })
      .toBeGreaterThan(0)

    // The DM downloads a sting mid-session. Nothing is re-picked, nothing restarted.
    fs.copyFileSync(join(FIXTURES, LATE), join(music, LATE))

    await expect
      .poll(async () => (await page.evaluate(() => window.doty.listMusic())).includes(LATE), {
        timeout: 120_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(true)

    // Measured, not merely listed: the lane comes from the seconds, so 0 s would
    // still read as a cue.
    await expect
      .poll(async () => Math.round((await page.evaluate(() => window.doty.getAllMetadata()))[LATE]?.duration ?? 0), {
        timeout: 120_000,
        intervals: [500, 1000, 2000],
      })
      .toBeGreaterThan(0)

    await expect
      .poll(async () => (await page.evaluate(() => window.doty.libraryLanes()))[LATE]?.lane, {
        timeout: 60_000,
        intervals: [250, 500, 1000],
      })
      .toBe('sfx')

    await app.evaluate(({ app: electronApp }) => {
      setTimeout(() => electronApp.quit(), 50)
    })
    await app.close().catch(() => {})
  } finally {
    if (app) await app.close().catch(() => {})
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(join(process.env.HOME ?? '', '.doty', 'profiles', profile), { recursive: true, force: true })
  }
})
