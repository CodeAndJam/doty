import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * The prune is a dev command, so its contract is the filesystem: an old profile
 * goes, a fresh one stays, the active one stays whatever its age, and `--dry`
 * removes nothing.
 */
const SCRIPT = join(process.cwd(), 'scripts', 'prune-profiles.mjs')
const roots: string[] = []

function root(): string {
  const dir = fs.mkdtempSync(join(tmpdir(), 'doty-prune-'))
  roots.push(dir)
  return dir
}

function profile(dir: string, name: string, ageDays: number, ephemeral = true): string {
  const path = join(dir, name)
  fs.mkdirSync(path, { recursive: true })
  if (ephemeral) fs.writeFileSync(join(path, '.ephemeral'), 'test')
  const when = new Date(Date.now() - ageDays * 86_400_000)
  fs.utimesSync(path, when, when)
  if (ephemeral) fs.utimesSync(join(path, '.ephemeral'), when, when)
  return path
}

function prune(args: string[]): string {
  return execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('prune-profiles', () => {
  it('removes a stale marked profile and keeps the fresh and the active one', () => {
    const dir = root()
    const stale = profile(dir, 'smoke-e2e-4242-abc', 3)
    const fresh = profile(dir, 'settings-e2e-4242-def', 0)
    const active = profile(dir, 'dbg-7777', 3)

    prune(['--root', dir, '--days', '1', '--keep', 'dbg-7777'])

    expect(fs.existsSync(stale)).toBe(false)
    expect(fs.existsSync(fresh)).toBe(true)
    expect(fs.existsSync(active)).toBe(true)
  })

  it('never removes an unmarked profile, whatever its age or name', () => {
    const dir = root()
    // A hand-named dev profile, and one whose name merely looks like a harness's.
    const named = profile(dir, 'mycampaign', 30, false)
    const lookalike = profile(dir, 'smoke-e2e-4242-abc', 30, false)

    prune(['--root', dir, '--days', '1'])

    expect(fs.existsSync(named)).toBe(true)
    expect(fs.existsSync(lookalike)).toBe(true)
  })

  it('removes nothing under --dry-run', () => {
    const dir = root()
    const stale = profile(dir, 'dbg-4242', 3)

    const output = prune(['--root', dir, '--days', '1', '--dry'])

    expect(fs.existsSync(stale)).toBe(true)
    expect(output).toContain('would remove 1')
  })

  it('ignores a missing root instead of failing a dev command', () => {
    expect(() => prune(['--root', join(root(), 'nope'), '--days', '1'])).not.toThrow()
  })
})
