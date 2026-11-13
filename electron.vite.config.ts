import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

/**
 * A git worktree devs against its own DOTY_PROFILE so two Doty instances can run
 * side by side. The main checkout (and CI) keeps the default profile.
 */
function applyWorktreeProfile(): void {
  if (process.env.DOTY_PROFILE) return
  try {
    const commonDir = execSync('git rev-parse --git-common-dir', { encoding: 'utf8', cwd: __dirname }).trim()
    if (resolve(commonDir) === resolve(__dirname, '.git')) return
    const suffix = createHash('sha1').update(__dirname).digest('hex').slice(0, 6)
    process.env.DOTY_PROFILE = `${basename(__dirname)}-${suffix}`
    console.log(`[doty] dev profile: ${process.env.DOTY_PROFILE}`)
  } catch {
    // not a git checkout — keep the default profile
  }
}

applyWorktreeProfile()

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
