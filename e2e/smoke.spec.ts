/**
 * E2E: the app can start, analyse a library, label an effect and quit.
 *
 * Three regressions reached a real DM without any test noticing, and all three
 * are visible in this one flow:
 *
 *   1. every track failed with MODULE_NOT_FOUND because a shared module was
 *      emitted under chunks/ and built its worker path from __dirname
 *   2. an 18-second sting in the music folder was labelled `music` because the
 *      library had been built before the analysis finished
 *   3. quitting with the window open threw from a closed database
 *
 * Run with `pnpm build && npx playwright test e2e/smoke.spec.ts`.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const FIXTURES = resolve(__dirname, 'fixtures')
const EFFECT = 'Weather - Thunder Crash 1.mp3' // 18 s: an effect by duration
const CUE = 'Fantasy Tavern.mp3' // 10 min: a cue by duration

test('starts, analyses, labels by seconds and quits cleanly', async () => {
  const profile = `smoke-e2e-${process.pid}-${test.info().testId}`.replace(/[^a-zA-Z0-9_-]+/g, '-')
  const root = fs.mkdtempSync(join(tmpdir(), 'doty-smoke-'))
  const music = join(root, 'music')
  fs.mkdirSync(music, { recursive: true })
  for (const file of [EFFECT, CUE]) fs.copyFileSync(join(FIXTURES, file), join(music, file))

  let app: ElectronApplication | undefined
  const stderr: string[] = []
  try {
    app = await electron.launch({
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, DOTY_PROFILE: profile, DOTY_E2E_HIDE_WINDOW: '1' },
    })
    app.process().stderr?.on('data', (chunk) => stderr.push(String(chunk)))

    const page: Page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const skip = page.getByText('Skip for now — set it up later in Settings')
    if (await skip.isVisible().catch(() => false)) await skip.click()

    await page.evaluate((dir: string) => window.doty.setMusicFolder(dir), music)

    // The analysis is what gives a file its seconds, and the seconds are what
    // decide its lane: wait for the effect to be measured rather than slept for.
    await expect
      .poll(
        async () => {
          const meta = await page.evaluate(() => window.doty.getAllMetadata())
          return Math.round(meta[EFFECT]?.duration ?? 0)
        },
        { timeout: 180_000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThan(0)

    // The label follows the measurement, not the other way round: poll rather
    // than assume the invalidated library has been rebuilt yet.
    await expect
      .poll(async () => (await page.evaluate(() => window.doty.libraryLanes()))[EFFECT]?.lane, {
        timeout: 30_000,
        intervals: [250, 500, 1000],
      })
      .toBe('sfx')
    const lanes = await page.evaluate(() => window.doty.libraryLanes())
    expect(lanes[CUE]?.lane).toBe('music')

    // Quit while the window is still open: this is the path that used to throw
    // from a closed database.
    await app.evaluate(({ app: electronApp }) => {
      setTimeout(() => electronApp.quit(), 50)
    })
    await app.close().catch(() => {})

    const log = stderr.join('')
    expect(log).not.toContain('MODULE_NOT_FOUND')
    expect(log).not.toContain('Uncaught Exception')
    expect(log).not.toContain('The database connection is not open')
  } finally {
    if (app) await app.close().catch(() => {})
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(join(process.env.HOME ?? '', '.doty', 'profiles', profile), { recursive: true, force: true })
  }
})
