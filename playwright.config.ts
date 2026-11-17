import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 300_000, // 5 min — first run downloads the reranker model (~80 MB)
  // Every spec launches its own Electron app. In parallel they fight over the
  // profile lock and the CPU, and the failures look like product bugs.
  workers: 1,
  use: {
    // Electron has no headless mode; this flag does nothing for `_electron`.
    // Hide the window instead: DOTY_E2E_HIDE_WINDOW=1 pnpm test:e2e
    headless: false,
  },
})
