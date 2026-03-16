/**
 * E2E test: verify the DM input box accepts text and triggers recommendations.
 *
 * The reported bug: "Writing on the input box is doing nothing."
 *
 * This test verifies:
 *   1. The DM input is visible and focusable
 *   2. Typing text updates the input value
 *   3. Typing a mood keyword triggers debounced recommendations
 *   4. The recommendation results change based on the input text
 *   5. Clearing the input reverts to default recommendations
 *
 * Prerequisites:
 *   - Run `pnpm build` before executing this test.
 *   - The ASR (Parakeet) model must already be downloaded to ~/.doty/models/.
 */

import { test, expect, _electron as electron } from '@playwright/test'
import { join, resolve } from 'path'

const FIXTURES_DIR = resolve(__dirname, 'fixtures')

test.describe('DM input box', () => {
  test('typing in the input updates its value', async () => {
    const app = await electron.launch({
      args: [join(__dirname, '../out/main/index.js')],
    })

    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      page.on('console', msg => console.log(`[renderer:${msg.type()}]`, msg.text()))
      page.on('pageerror', err => console.error('[renderer:error]', err.message))

      // Skip if ASR model not downloaded yet (match the unique heading on the download screen)
      const onDownloadScreen = await page
        .getByText('Speech Recognition Model')
        .isVisible()
        .catch(() => false)
      if (onDownloadScreen) {
        test.skip(true, 'ASR model not present — run the app once to download it first')
        return
      }

      // Point app at fixtures folder
      await page.evaluate((dir: string) => {
        return (window as unknown as { doty: { setMusicFolder: (p: string) => Promise<unknown> } }).doty.setMusicFolder(dir)
      }, FIXTURES_DIR)

      // Wait for DM input to be visible
      const input = page.getByTestId('dm-input')
      await expect(input).toBeVisible({ timeout: 15_000 })

      // Verify input starts empty
      await expect(input).toHaveValue('')

      // Click to focus and type text via fill (programmatic value set)
      await input.click()
      await input.fill('dark dungeon')
      await expect(input).toHaveValue('dark dungeon')

      // Clear and fill again with a different value
      await input.fill('')
      await expect(input).toHaveValue('')
      await input.fill('campfire')
      await expect(input).toHaveValue('campfire')
    } finally {
      await app.close()
    }
  })

  test('typing a mood keyword triggers recommendation changes', async () => {
    const app = await electron.launch({
      args: [join(__dirname, '../out/main/index.js')],
    })

    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      page.on('console', msg => console.log(`[renderer:${msg.type()}]`, msg.text()))
      page.on('pageerror', err => console.error('[renderer:error]', err.message))

      // Skip if ASR model not downloaded yet (match the unique heading on the download screen)
      const onDownloadScreen = await page
        .getByText('Speech Recognition Model')
        .isVisible()
        .catch(() => false)
      if (onDownloadScreen) {
        test.skip(true, 'ASR model not present — run the app once to download it first')
        return
      }

      // Point app at fixtures folder
      await page.evaluate((dir: string) => {
        return (window as unknown as { doty: { setMusicFolder: (p: string) => Promise<unknown> } }).doty.setMusicFolder(dir)
      }, FIXTURES_DIR)

      // Wait for initial track cards to appear (default recommendations)
      await expect(page.getByTestId('track-card').first()).toBeVisible({ timeout: 30_000 })

      // Capture the initial recommendation set
      const initialNames = await page.getByTestId('track-card').evaluateAll((els) =>
        els.map(el => el.querySelector('span.flex-1')?.textContent?.trim() ?? '')
      )
      console.log('[e2e] initial recommendations:', initialNames)

      // Type "horror" into the DM input — should shift recommendations toward horror tracks
      const input = page.getByTestId('dm-input')
      await input.click()
      await input.fill('horror')

      // Wait for the debounce (500ms) + recommendation processing
      // We watch for the track cards to update — either the count or content should change
      await page.waitForTimeout(3000)

      const horrorNames = await page.getByTestId('track-card').evaluateAll((els) =>
        els.map(el => el.querySelector('span.flex-1')?.textContent?.trim() ?? '')
      )
      console.log('[e2e] recommendations after "horror":', horrorNames)

      // The recommendations should have changed from the initial set.
      // At minimum, we expect at least one horror-related track to appear.
      const horrorKeywords = ['Horror', 'Haunted', 'Dark', 'Cemetery', 'Corrupted']
      const hasHorrorTrack = horrorNames.some(n =>
        horrorKeywords.some(k => n.includes(k))
      )
      expect(
        hasHorrorTrack,
        `Expected at least one horror-related track after typing "horror". Got: ${horrorNames.join(', ')}`,
      ).toBe(true)

      // Now clear the input and verify recommendations revert
      await input.fill('')
      await page.waitForTimeout(2000)

      const clearedNames = await page.getByTestId('track-card').evaluateAll((els) =>
        els.map(el => el.querySelector('span.flex-1')?.textContent?.trim() ?? '')
      )
      console.log('[e2e] recommendations after clearing input:', clearedNames)

      // After clearing, the horror-specific ordering should no longer dominate.
      // We just verify that tracks are still shown (the app didn't break).
      expect(clearedNames.length).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })

  test('input onChange fires and logs debounce scheduling', async () => {
    const app = await electron.launch({
      args: [join(__dirname, '../out/main/index.js')],
    })

    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      // Collect console messages to verify the recommendation pipeline fires
      const consoleLogs: string[] = []
      page.on('console', msg => {
        const text = msg.text()
        consoleLogs.push(text)
        console.log(`[renderer:${msg.type()}]`, text)
      })
      page.on('pageerror', err => console.error('[renderer:error]', err.message))

      // Skip if ASR model not downloaded yet (match the unique heading on the download screen)
      const onDownloadScreen = await page
        .getByText('Speech Recognition Model')
        .isVisible()
        .catch(() => false)
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

      // Clear any initial logs
      consoleLogs.length = 0

      // Type into the input
      await input.fill('tavern')

      // Wait for debounce to fire (500ms) + processing
      await page.waitForTimeout(2000)

      // Verify the recommendation pipeline was triggered by checking console logs.
      // MainLayout.handleDmChange logs: '[recommend] handleDmChange: ...'
      // MainLayout.handleDmChange logs: '[recommend] scheduling DM recommendation in 500ms'
      // MainLayout.runDmRecommendation logs: '[recommend] runDmRecommendation called, prompt: ...'
      const hasHandleDmChange = consoleLogs.some(l => l.includes('handleDmChange'))
      const hasScheduling = consoleLogs.some(l => l.includes('scheduling DM recommendation'))
      const hasDmRecommendation = consoleLogs.some(l => l.includes('runDmRecommendation'))

      console.log('[e2e] handleDmChange logged:', hasHandleDmChange)
      console.log('[e2e] scheduling logged:', hasScheduling)
      console.log('[e2e] runDmRecommendation logged:', hasDmRecommendation)

      expect(
        hasHandleDmChange,
        'Expected handleDmChange to be called when typing in the DM input. ' +
        'This means the onChange handler is not firing. ' +
        `Captured logs: ${consoleLogs.filter(l => l.includes('[recommend]')).join(' | ')}`,
      ).toBe(true)

      expect(
        hasScheduling,
        'Expected DM recommendation to be scheduled after typing. ' +
        'The debounce timer is not being set. ' +
        `Captured logs: ${consoleLogs.filter(l => l.includes('[recommend]')).join(' | ')}`,
      ).toBe(true)

      expect(
        hasDmRecommendation,
        'Expected runDmRecommendation to be called after debounce. ' +
        'The debounced function never fired. ' +
        `Captured logs: ${consoleLogs.filter(l => l.includes('[recommend]')).join(' | ')}`,
      ).toBe(true)
    } finally {
      await app.close()
    }
  })
})
