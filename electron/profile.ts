import fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * `DOTY_PROFILE` gives a second checkout (a git worktree running `pnpm dev`)
 * its own database, sessions and Electron settings. Downloaded models stay
 * shared in `~/.doty/models`, so a new profile does not re-download 2 GB.
 */
const raw = process.env.DOTY_PROFILE?.trim()
  .replace(/[^a-zA-Z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')

/** Empty on the normal install; the profile name otherwise. */
export const PROFILE = raw || ''

export const DOTY_HOME = PROFILE ? join(homedir(), '.doty', 'profiles', PROFILE) : join(homedir(), '.doty')

/** Electron's own profile (settings, caches, Chromium lock). One per instance. */
export const USER_DATA_DIR = PROFILE ? join(DOTY_HOME, 'electron') : app.getPath('userData')

if (PROFILE) app.setPath('userData', USER_DATA_DIR)

/**
 * A profile the test harness created is disposable by construction; a hand-named
 * dev profile is the DM's data. `pnpm profile:prune` trusts only this marker, so
 * it never has to guess from a name.
 */
if (PROFILE && process.env.DOTY_TEST_PROFILE === '1') {
  try {
    fs.mkdirSync(DOTY_HOME, { recursive: true })
    fs.writeFileSync(join(DOTY_HOME, '.ephemeral'), new Date().toISOString())
  } catch {
    // The profile still works; it just will not be pruned.
  }
}
