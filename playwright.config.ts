import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 300_000, // 5 min — first run downloads the Qwen model (~400 MB)
  use: {
    headless: false,
  },
})
