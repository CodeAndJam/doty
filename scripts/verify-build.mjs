/**
 * Assert the build produced the worker entry points where the app looks for them.
 *
 * A worker entry that imports a module another entry also imports makes Rollup
 * move that module into `chunks/`. If the module builds a worker path from
 * `__dirname`, the path silently points at `chunks/` and every track fails to
 * analyse. The build stays green, the app runs, and the log fills with
 * MODULE_NOT_FOUND. This is the check that notices.
 */
import fs from 'node:fs'
import { join } from 'node:path'

const OUT = join(process.cwd(), 'out', 'main')
const WORKERS = ['analyze-worker.js', 'transcribe-worker.js', 'ranker-worker.js', 'embedder-worker.js']

const problems = []

for (const worker of WORKERS) {
  if (!fs.existsSync(join(OUT, worker))) problems.push(`missing ${join('out/main', worker)}`)
}

// The failure mode in one sentence: a chunk that mentions a worker filename is a
// module that builds its path from the wrong directory.
const chunksDir = join(OUT, 'chunks')
if (fs.existsSync(chunksDir)) {
  for (const file of fs.readdirSync(chunksDir)) {
    if (!file.endsWith('.js')) continue
    const source = fs.readFileSync(join(chunksDir, file), 'utf8')
    for (const worker of WORKERS) {
      if (source.includes(worker)) {
        problems.push(`${file} references ${worker}: it will resolve a path under chunks/`)
      }
    }
  }
}

// Effect is ESM-only and is inlined into main. A value import that reaches the
// preload emits `require("effect")`, which throws before `window.doty` exists.
const preload = join(process.cwd(), 'out', 'preload', 'index.js')
if (fs.existsSync(preload) && fs.readFileSync(preload, 'utf8').includes('require("effect")')) {
  problems.push('out/preload/index.js requires Effect: it is ESM-only and will throw')
}

for (const required of ['index.js', join('..', 'preload', 'index.js')]) {
  if (!fs.existsSync(join(OUT, required))) problems.push(`missing out/main/${required}`)
}

if (problems.length > 0) {
  console.error('[verify-build] the build cannot run:\n' + problems.map((p) => `  - ${p}`).join('\n'))
  process.exit(1)
}
console.log('[verify-build] worker entries are in place')
