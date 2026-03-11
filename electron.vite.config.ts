import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

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
          'asr-worker': resolve(__dirname, 'electron/asr-worker.ts'),
          'qwen-worker': resolve(__dirname, 'electron/qwen-worker.ts'),
          'qwen-child': resolve(__dirname, 'electron/qwen-child.ts'),
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.ts') }
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') }
      }
    },
    plugins: [react()],
    worker: {
      format: 'iife'
    }
  }
})
