#!/usr/bin/env node
/**
 * Delete old test profiles. Every e2e spec and probe run makes one under
 * `~/.doty/profiles`, and a run that is killed leaves it behind: 88 profiles
 * and 378 MB accumulated in one afternoon.
 *
 *   pnpm profile:prune              # test profiles older than a day
 *   pnpm profile:prune --days 7 --dry
 *
 * Only directories carrying the `.ephemeral` marker are eligible. The app
 * writes that marker when `DOTY_TEST_PROFILE=1`, so a hand-named dev profile
 * (`DOTY_PROFILE=mycampaign`) is never guessed at from its name and never
 * removed. The active profile is kept as well, and a missing root is not an
 * error: this runs by hand, and a machine that has never started the app has
 * nothing to prune.
 */
import fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? fallback : args[at + 1]
}

const root = option('root', join(homedir(), '.doty', 'profiles'))
const days = Number(option('days', '1'))
const dry = args.includes('--dry')
const keep = new Set(
  String(option('keep', process.env.DOTY_PROFILE ?? ''))
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
)

if (!Number.isFinite(days) || days < 0) {
  console.error('[profiles] --days must be a non-negative number')
  process.exit(1)
}

let entries = []
try {
  entries = fs.readdirSync(root, { withFileTypes: true })
} catch (err) {
  if (err.code === 'ENOENT') {
    console.log(`[profiles] nothing to prune (${root} does not exist)`)
    process.exit(0)
  }
  throw err
}

const cutoff = Date.now() - days * 86_400_000
let removed = 0
let kept = 0
for (const entry of entries) {
  if (!entry.isDirectory() || keep.has(entry.name)) {
    kept++
    continue
  }
  const path = join(root, entry.name)
  const marker = join(path, '.ephemeral')
  let stale = false
  try {
    // The marker's age is the profile's age: written once, when it was created.
    stale = fs.statSync(marker).mtimeMs < cutoff
  } catch {
    // No marker: not ours to delete.
    kept++
    continue
  }
  if (!stale) {
    kept++
    continue
  }
  if (!dry) fs.rmSync(path, { recursive: true, force: true })
  removed++
}

console.log(`[profiles] ${dry ? 'would remove' : 'removed'} ${removed}, kept ${kept} in ${root}`)
