import { defineConfig } from '@playwright/test'

// Playback is real in the app, so the suite would play music out of the machine's
// speakers. Mute the window for every run; `DOTY_E2E_MUTE=0` opts back in.
process.env.DOTY_E2E_MUTE ??= '1'
// No model downloads during e2e: tests that need one skip, and a temp HOME does
// not fetch 1.8 GB while asserting the UI. `DOTY_E2E_NO_MODEL_DOWNLOAD=0` opts in.
process.env.DOTY_E2E_NO_MODEL_DOWNLOAD ??= '1'

export default defineConfig({
  testDir: './e2e',
  // One probe before any spec: a host that cannot run Electron must not read as
  // a branch failure (see the file).
  globalSetup: './e2e/global-setup.ts',
  timeout: 300_000, // 5 min — first run downloads the reranker model (~80 MB)
  // A firstWindow timeout under load is not a product failure; one retry keeps
  // the nightly signal about behaviour, not machine weather.
  retries: process.env.CI ? 2 : 1,
  // Every spec launches its own Electron app. In parallel they fight over the
  // profile lock and the CPU, and the failures look like product bugs.
  workers: 1,
  use: {
    // Electron has no headless mode; this flag does nothing for `_electron`.
    // Hide the window instead: DOTY_E2E_HIDE_WINDOW=1 pnpm test:e2e
    headless: false,
  },
})
