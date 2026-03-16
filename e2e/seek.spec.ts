/**
 * E2E test: verify that seeking works correctly after the Range-request fix.
 *
 * The original bug (#26): setting audio.currentTime triggered a Range request,
 * but the music:// protocol handler always returned the full file from byte 0,
 * so the seek position reset to the beginning.
 *
 * This test verifies the fix by:
 *   1. Playing a track
 *   2. Seeking to 75% by setting audio.currentTime directly (triggers Range request)
 *   3. Waiting for the audio element to settle
 *   4. Asserting audio.currentTime is > 50% of duration
 *
 * Prerequisites:
 *   - Run `pnpm build` before executing this test.
 *   - The ASR (Parakeet) model must already be downloaded to ~/.doty/models/.
 */

import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { join, resolve } from 'path'

const FIXTURES_DIR = resolve(__dirname, 'fixtures')

/** Gracefully quit Electron so macOS doesn't show "quit unexpectedly" dialog. */
async function gracefulClose(app: ElectronApplication) {
  await app.evaluate(({ app: electronApp }) => {
    setTimeout(() => electronApp.quit(), 50)
  })
  await app.close()
}

test('seek bar reflects correct position after seeking to 75%', async () => {
  const app = await electron.launch({
    args: [join(__dirname, '../out/main/index.js')],
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    page.on('console', msg => console.log(`[renderer:${msg.type()}]`, msg.text()))
    page.on('pageerror', err => console.error('[renderer:error]', err.message))

    // Patch Audio constructor to capture instances for testing
    await page.evaluate(() => {
      const origAudio = window.Audio
      ;(window as unknown as { __audioInstances: HTMLAudioElement[] }).__audioInstances = []
      window.Audio = function(src?: string) {
        const a = new origAudio(src)
        ;(window as unknown as { __audioInstances: HTMLAudioElement[] }).__audioInstances.push(a)
        return a
      } as unknown as typeof Audio
      window.Audio.prototype = origAudio.prototype
    })

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

    // Wait for at least one track card to appear
    await expect(page.getByTestId('track-card').first()).toBeVisible({ timeout: 30_000 })

    // Click the play button on the first track card
    const firstTrack = page.getByTestId('track-card').first()
    await firstTrack.getByRole('button').first().click()

    // Wait for the seek bar to appear and audio to start playing
    const seekBar = page.getByRole('slider', { name: 'Seek' })
    await expect(seekBar).toBeVisible({ timeout: 15_000 })
    await page.waitForFunction(() => {
      const slider = document.querySelector('[role="slider"][aria-label="Seek"]')
      return slider && Number(slider.getAttribute('aria-valuenow')) > 0
    }, { timeout: 15_000 })

    // Seek to 75% by directly setting audio.currentTime.
    // This triggers a Range request to the music:// protocol handler —
    // the exact operation that was broken before the fix.
    const seekResult = await page.evaluate(() => {
      const instances = (window as unknown as { __audioInstances: HTMLAudioElement[] }).__audioInstances
      const audio = instances.find(a => a.duration > 0 && !a.paused)
      if (!audio) return { error: 'no playing audio found', count: instances.length }
      const target = audio.duration * 0.75
      audio.currentTime = target
      return { duration: audio.duration, seekedTo: target }
    })
    console.log(`[e2e] seek:`, JSON.stringify(seekResult))

    // Wait for the Range request to complete and audio to settle
    await page.waitForTimeout(2000)

    // Verify audio.currentTime stayed at the seeked position
    const audioState = await page.evaluate(() => {
      const instances = (window as unknown as { __audioInstances: HTMLAudioElement[] }).__audioInstances
      const audio = instances.find(a => a.duration > 0)
      if (!audio) return { pct: -1 }
      return { pct: (audio.currentTime / audio.duration) * 100 }
    })
    console.log(`[e2e] audio position after seek: ${audioState.pct.toFixed(1)}%`)

    // Assert that the audio position is > 50% (we sought to 75%)
    expect(
      audioState.pct,
      `Expected audio position > 50% after seeking to 75%, got ${audioState.pct.toFixed(1)}%`,
    ).toBeGreaterThan(50)

  } finally {
    await gracefulClose(app)
  }
})
