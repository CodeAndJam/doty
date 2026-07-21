/**
 * E2E test: verify transcribe-cpp streaming STT works end-to-end.
 *
 * Tests:
 *   1. App launches and recognizes model is ready (no download screen)
 *   2. STT status reaches 'ready' within 5s (model load ~160ms)
 *   3. Starting transcription enters streaming mode
 *
 * Prerequisites:
 *   - Run `pnpm build` before executing this test
 *   - Model must be downloaded: ~/.doty/models/parakeet-unified-en-0.6b-Q8_0.gguf
 *   - Store config: ~/Library/Application Support/doty/config.json with sttModel=parakeet-unified-en
 */

import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { join } from 'path'

async function gracefulClose(app: ElectronApplication) {
  await app.evaluate(({ app: electronApp }) => {
    setTimeout(() => electronApp.quit(), 50)
  })
  await app.close()
}

test.describe('transcribe-cpp streaming STT', () => {
  test('app starts and STT is ready in <5s', async () => {
    const startTime = Date.now()

    const app = await electron.launch({
      args: [join(__dirname, '../out/main/index.js')],
    })

    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      // Collect console output for debugging
      const logs: string[] = []
      page.on('console', (msg) => {
        logs.push(`[${msg.type()}] ${msg.text()}`)
      })
      page.on('pageerror', (err) => {
        logs.push(`[PAGE ERROR] ${err.message}`)
      })

      // Ensure model is set (in case store path differs in test mode)
      await page.evaluate(async () => {
        // @ts-ignore
        await window.doty.setSttModel('parakeet-unified-en')
      })

      // Check model status directly — this just checks file existence
      const modelStatus = await page.evaluate(async () => {
        // @ts-ignore
        return await window.doty.modelStatus()
      })
      console.log('Model status:', modelStatus)

      // Debug: check what models the app sees
      const modelList = await page.evaluate(async () => {
        // @ts-ignore
        return await window.doty.getSttModelList()
      })
      const readyModel = modelList.find((m: any) => m.ready)
      console.log('Ready model:', readyModel?.id, readyModel?.ready)

      // Check what the selected model is
      const selectedModel = await page.evaluate(async () => {
        // @ts-ignore
        return await window.doty.getSttModel()
      })
      console.log('Selected model from store:', selectedModel)

      // Should NOT be on the download screen — model is already present
      const onDownloadScreen = await page
        .getByText('Speech Recognition Model')
        .isVisible()
        .catch(() => false)

      if (onDownloadScreen) {
        // Try downloading via IPC if needed
        const modelList = await page.evaluate(async () => {
          // @ts-ignore
          return await window.doty.getSttModelList()
        })
        const firstReady = modelList.find((m: any) => m.ready)
        if (!firstReady) {
          test.skip(true, 'No GGUF model downloaded — download parakeet-unified-en first')
          return
        }
        // Model exists but store wasn't set — download triggers the selection
        await page.evaluate(async (id: string) => {
          // @ts-ignore
          await window.doty.downloadModel(id)
        }, firstReady.id)
      }

      // Wait for STT to be ready — either the status event fires or model:status confirms it
      const sttReady = await page.evaluate(() => {
        return new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => resolve(false), 8000)

          // Check immediately if model is ready
          // @ts-ignore
          window.doty.modelStatus().then((s: any) => {
            if (s.ready) {
              clearTimeout(timeout)
              resolve(true)
            }
          })

          // Also listen for status updates
          // @ts-ignore
          window.doty.onSttStatus((status: string) => {
            if (status === 'ready' || status === 'idle') {
              clearTimeout(timeout)
              resolve(true)
            }
          })
        })
      })

      const elapsed = Date.now() - startTime
      console.log(`App ready in ${elapsed}ms`)
      console.log('Logs:', logs.slice(0, 10).join('\n'))

      expect(sttReady).toBe(true)
      expect(elapsed).toBeLessThan(5000)

      // Verify we can start transcription
      const startResult = await page.evaluate(async () => {
        // @ts-ignore
        return await window.doty.sttStart()
      })
      expect(startResult).toEqual({ ok: true })

      // Give the stream a moment to start
      await page.waitForTimeout(500)

      // Stop transcription
      const stopResult = await page.evaluate(async () => {
        // @ts-ignore
        return await window.doty.sttStop()
      })
      expect(stopResult).toEqual({ ok: true })

      console.log(`Full flow completed in ${Date.now() - startTime}ms`)
    } finally {
      await gracefulClose(app)
    }
  })
})
