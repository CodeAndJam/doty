/**
 * E2E test: launch the app, type "campfire" in the DM input,
 * and assert that the recommendation model returns relevant tracks.
 *
 * The DM input triggers recommendations via a 500ms debounce on change.
 *
 * Prerequisites:
 *   - Run `npm run build` before executing this test.
 *   - The ASR (Parakeet) model must already be downloaded to ~/.doty/models/.
 *     If it is not, the test is skipped automatically.
 *   - The MiniLM reranker recommendation model (~80 MB) is downloaded on first run;
 *     allow up to 2 minutes for that on a cold start.
 *
 * How we verify the model actually ran (not the fallback):
 *   The fallback always returns the first 5 files in filesystem order.
 *   The fixture folder has 42 tracks. For the prompt "campfire" the model
 *   should rank mood-relevant tracks highly (e.g. Campfire.mp3,
 *   Downtime - Bonfire.mp3, Tavern tracks). We assert that the result
 *   contains "Campfire.mp3" — a file that is NOT in the first-5 fallback
 *   (alphabetically: Campfire.mp3 IS first, but Decisive Battle - Rivals.mp3
 *   would NOT be expected in a campfire recommendation).
 *   More robustly: we assert the 5 results are not identical to the
 *   alphabetical first-5, which would only happen if the fallback fired.
 */

import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { join, resolve } from 'path'
import fs from 'fs'

const FIXTURES_DIR = resolve(__dirname, 'fixtures')

/** Gracefully quit Electron so macOS doesn't show "quit unexpectedly" dialog. */
async function gracefulClose(app: ElectronApplication) {
  await app.evaluate(({ app: electronApp }) => {
    setTimeout(() => electronApp.quit(), 50)
  })
  await app.close()
}

// Alphabetical first-5 — what the fallback would return
const FALLBACK_FIRST_5 = fs.readdirSync(FIXTURES_DIR)
  .filter(f => f.endsWith('.mp3'))
  .sort()
  .slice(0, 5)

test('typing "campfire" returns model recommendations, not the fallback', async () => {
  const app = await electron.launch({
    args: [join(__dirname, '../out/main/index.js')],
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    // Capture renderer console to see worker errors
    page.on('console', msg => console.log(`[renderer:${msg.type()}]`, msg.text()))
    page.on('pageerror', err => console.error('[renderer:error]', err.message))

    // Skip if ASR model not downloaded yet (match the unique heading on the download screen)
    const onDownloadScreen = await page.getByText('Speech Recognition Model').isVisible().catch(() => false)
    if (onDownloadScreen) {
      test.skip(true, 'ASR model not present — run the app once to download it first')
      return
    }

    // Point app at fixtures folder
    await page.evaluate((dir: string) => {
      return (window as unknown as { doty: { setMusicFolder: (p: string) => Promise<unknown> } }).doty.setMusicFolder(dir)
    }, FIXTURES_DIR)

    // Wait for DM input
    const input = page.getByTestId('dm-input')
    await expect(input).toBeVisible({ timeout: 15_000 })

    // Type "campfire" — recommendations trigger via 500ms debounce
    await input.fill('campfire')

    // Wait for debounce (500ms) + reranker model load (up to 5 min on first run) + inference
    await expect(page.getByTestId('track-card')).toHaveCount(5, { timeout: 300_000 })

    // Allow extra time for the reranker model to finish loading and re-rank
    // The initial cards may be heuristic fallback; wait for a reranker-powered update
    await page.waitForTimeout(5000)

    // Collect the track names shown in the UI
    const cards = page.getByTestId('track-card')
    const names = await cards.evaluateAll((els) =>
      els.map(el => el.querySelector('span.flex-1')?.textContent?.trim() ?? '')
    )
    console.log('[e2e] recommended tracks:', names)

    // Assert the model ran: results must NOT be identical to the alphabetical fallback
    const fallbackNames = FALLBACK_FIRST_5.map(f => f.replace(/\.[^.]+$/, ''))
    const isFallback = names.every((n, i) => n === fallbackNames[i])
    expect(isFallback, `Got fallback results — model did not run. Got: ${names.join(', ')}`).toBe(false)

    // Assert at least one mood-relevant track is present
    const relevant = ['Campfire', 'Bonfire', 'Tavern', 'Downtime', 'Halfling', 'Peaceful', 'Ambience']
    const hasRelevant = names.some(n => relevant.some(r => n.includes(r)))
    expect(hasRelevant, `No mood-relevant track found in: ${names.join(', ')}`).toBe(true)
  } finally {
    await gracefulClose(app)
  }
})
