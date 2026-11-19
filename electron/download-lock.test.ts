// @vitest-environment node
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { withDownloadLock } from './download-lock'

const dirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(join(tmpdir(), 'doty-lock-'))
  dirs.push(dir)
  return dir
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('withDownloadLock', () => {
  it('runs the download and removes the lock', async () => {
    const dest = join(tempDir(), 'model.gguf')
    let ran = false

    await withDownloadLock(dest, undefined, async () => {
      ran = true
    })

    expect(ran).toBe(true)
    expect(fs.existsSync(`${dest}.lock`)).toBe(false)
  })

  it('waits for the other process and skips a file it finished', async () => {
    const dir = tempDir()
    const dest = join(dir, 'model.gguf')
    let release!: () => void
    let ran = false

    const first = withDownloadLock(dest, undefined, async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      fs.writeFileSync(dest, 'bytes')
    })
    await waitFor(() => fs.existsSync(`${dest}.lock`))

    const second = withDownloadLock(dest, undefined, async () => {
      ran = true
    })
    release()
    await first
    await second

    expect(ran).toBe(false)
    expect(fs.readFileSync(dest, 'utf8')).toBe('bytes')
  })

  it('breaks a lock whose process is gone', async () => {
    const dest = join(tempDir(), 'model.gguf')
    fs.writeFileSync(`${dest}.lock`, '4294967295')
    let ran = false

    await withDownloadLock(dest, undefined, async () => {
      ran = true
    })

    expect(ran).toBe(true)
  })

  it('breaks a lock left empty by a crash, once it is old', async () => {
    const dest = join(tempDir(), 'model.gguf')
    const lock = `${dest}.lock`
    fs.writeFileSync(lock, '')
    const old = Date.now() / 1000 - 120
    fs.utimesSync(lock, old, old)
    let ran = false

    await withDownloadLock(dest, undefined, async () => {
      ran = true
    })

    expect(ran).toBe(true)
  })

  it('rejects while waiting when the caller aborts', async () => {
    const dest = join(tempDir(), 'model.gguf')
    fs.writeFileSync(`${dest}.lock`, String(process.pid))
    const controller = new AbortController()

    const waiting = withDownloadLock(dest, controller.signal, async () => {})
    controller.abort()

    await expect(waiting).rejects.toThrow(/cancelled/i)
  })
})
