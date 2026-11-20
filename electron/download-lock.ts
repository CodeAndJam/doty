/**
 * One writer per model file.
 *
 * Profiles share `~/.doty/models`, so two instances can fetch the same model at
 * the same time. They would write the same `.part`, interleave bytes and leave a
 * file that looks installed and fails to load. A lock named after the destination
 * makes the second instance wait, then skip what the first one wrote.
 *
 * The lock carries the owner's pid so a crashed download does not block forever.
 */
import fs from 'node:fs'
import { dirname } from 'node:path'

const POLL_MS = 100
/** A lock with no readable pid is only trusted this long: a crash between create and write leaves one. */
const UNWRITTEN_LOCK_MS = 60_000

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function ownerOf(lockPath: string): number {
  try {
    return Number.parseInt(fs.readFileSync(lockPath, 'utf8'), 10)
  } catch {
    return 0
  }
}

function modifiedAt(lockPath: string): number {
  try {
    return fs.statSync(lockPath).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Hold `<dest>.lock` while `write` runs. Waits for a live owner, steals the lock
 * from a dead one, and returns without running `write` when the file arrived
 * from another instance while waiting.
 */
export async function withDownloadLock(
  destPath: string,
  signal: AbortSignal | undefined,
  write: () => Promise<void>,
): Promise<void> {
  const lockPath = `${destPath}.lock`
  // A fresh install has no ~/.doty/models yet; the lock creates it before any
  // transfer would have.
  fs.mkdirSync(dirname(lockPath), { recursive: true })
  for (;;) {
    if (signal?.aborted) throw new Error('Download cancelled')
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' })
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      const owner = ownerOf(lockPath)
      if (!owner) {
        if (Date.now() - modifiedAt(lockPath) > UNWRITTEN_LOCK_MS) {
          fs.rmSync(lockPath, { force: true })
          continue
        }
      } else if (!isAlive(owner)) {
        fs.rmSync(lockPath, { force: true })
        continue
      }
      if (fs.existsSync(destPath)) return
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

  try {
    if (fs.existsSync(destPath)) return
    await write()
  } finally {
    fs.rmSync(lockPath, { force: true })
  }
}
