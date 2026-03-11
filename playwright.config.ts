import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 300_000, // 5 min — first run downloads the reranker model (~80 MB)
  use: {
    headless: false,
  },
})
