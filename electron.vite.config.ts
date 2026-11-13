import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ['chokidar', 'music-metadata'],
      },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
          'analyze-worker': resolve(__dirname, 'electron/analyze-worker.ts'),
          'transcribe-worker': resolve(__dirname, 'electron/transcribe-worker.ts'),
          'ranker-worker': resolve(__dirname, 'electron/ranker-worker.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.ts') },
      },
    },
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') },
      },
    },
    plugins: [react()],
    worker: {
      format: 'iife',
    },
  },
})
