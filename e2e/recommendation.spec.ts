/**
 * E2E: the whole ranker flow, in the order a DM meets it.
 *
 *   1. the model is already installed, so nothing downloads (the archive is
 *      fetched once; a missing model skips this test rather than pulling 1.5 GB)
 *   2. the first prompt is answered by keyword matching, immediately, while the
 *      graph is still loading in the worker
 *   3. the UI says which mode answered
 *   4. once the model is warm, a prompt is answered by the decision model with a
 *      calibrated confidence, and the ranking changes
 *
 * Run with `pnpm build && npx playwright test e2e/recommendation.spec.ts`.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import { join, resolve } from 'node:path'

const FIXTURES_DIR = resolve(__dirname, 'fixtures')

async function gracefulClose(app: ElectronApplication) {
  await app.evaluate(({ app: electronApp }) => {
    setTimeout(() => electronApp.quit(), 50)
  })
  await app.close()
}

/** Track names as rendered, in order. */
async function shownTracks(page: Page): Promise<string[]> {
  return page
    .getByTestId('track-card')
    .evaluateAll((els) => els.map((el) => el.querySelector('span.flex-1')?.textContent?.trim() ?? ''))
}

/**
 * The model loads on an idle callback, so a prompt sent too early is answered by
 * keywords. Re-prompt until the badge switches, which is exactly what a DM
 * typing at the table does.
 */
async function waitForModelRanking(page: Page, input: ReturnType<Page['getByTestId']>) {
  const badge = page.getByTestId('ranker-badge')
  for (let attempt = 0; attempt < 40; attempt++) {
    const text = (await badge.textContent()) ?? ''
    if (/^model/.test(text.trim())) return text.trim()
    await input.fill(`campfire${' '.repeat(attempt % 2 === 0 ? 1 : 0)}`)
    await page.waitForTimeout(1500)
  }
  throw new Error(`model never ranked; badge stayed at "${(await badge.textContent()) ?? ''}"`)
}

test('keyword fallback answers while the model loads, then the model takes over', async () => {
  const app = await electron.launch({ args: [join(__dirname, '../out/main/index.js')] })
  let page: Page | undefined
  let previousFolder: string | null = null

  try {
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    page.on('pageerror', (err) => console.error('[renderer:error]', err.message))

    if (await page.getByText('Speech Recognition Model').isVisible().catch(() => false)) {
      test.skip(true, 'ASR model not present — run the app once to download it first')
      return
    }

    // Requirement: the model is installed, so this run downloads nothing.
    const status = await page.evaluate(() => window.doty.rankerStatus())
    expect(status.cached, 'ranker model missing — download it once in Settings first').toBe(true)

    // The spec runs against the real user data dir, so the folder is restored on exit.
    previousFolder = await page.evaluate(() => window.doty.getMusicFolder())
    await page.evaluate((dir: string) => window.doty.setMusicFolder(dir), FIXTURES_DIR)

    const input = page.getByTestId('dm-input')
    await expect(input).toBeVisible({ timeout: 15_000 })

    // First prompt: cards must appear without waiting for a 1.5 GB graph.
    await input.fill('campfire')
    await expect(page.getByTestId('track-card')).toHaveCount(5, { timeout: 30_000 })
    const early = await shownTracks(page)
    const earlyBadge = ((await page.getByTestId('ranker-badge').textContent()) ?? '').trim()
    console.log('[e2e] first answer:', earlyBadge, early)
    expect(earlyBadge).toMatch(/^keywords/)

    // The model finishes loading in the background and takes over.
    const badgeText = await waitForModelRanking(page, input)
    console.log('[e2e] ranker badge:', badgeText)
    const confidence = Number(badgeText.replace(/[^0-9.]/g, ''))
    expect(confidence).toBeGreaterThan(0)

    const ranked = await shownTracks(page)
    console.log('[e2e] model ranking:', ranked)
    expect(ranked).not.toEqual(early)

    const relevant = ['Campfire', 'Bonfire', 'Tavern', 'Downtime', 'Halfling', 'Peaceful', 'Ambience']
    expect(ranked.some((n) => relevant.some((r) => n.includes(r))), `no mood-relevant track in ${ranked.join(', ')}`).toBe(
      true,
    )

  } finally {
    if (page && previousFolder) {
      await page.evaluate((dir: string) => window.doty.setMusicFolder(dir), previousFolder).catch(() => {})
    }
    await gracefulClose(app)
  }
})
