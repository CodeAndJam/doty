/**
 * The ranker archive is a trust boundary: a 1.5 GB download that silently
 * unpacks the wrong thing is worse than no model at all. These tests build a
 * throwaway archive and check that only the expected bytes are accepted.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractRankerArchive, installRankerArchive, isRankerInstalled, sha256File, verifyArchive } from './d1-model'

const dirs: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'doty-ranker-'))
  dirs.push(dir)
  return dir
}

/** A source tree shaped like the real payload, packed the way the export script packs it. */
function makeArchive(): { archive: string; digest: string } {
  const build = scratch()
  mkdirSync(join(build, 'd1-omni-src'))
  writeFileSync(join(build, 'd1-omni-text.onnx'), 'graph')
  writeFileSync(join(build, 'd1-omni-text-manifest.json'), '{}')
  writeFileSync(join(build, 'd1-omni-src', 'tokenizer.json'), '{}')
  writeFileSync(join(build, 'd1-omni-src', 'tokenizer_config.json'), '{}')

  const archive = join(scratch(), 'ranker.tar.gz')
  execFileSync('tar', ['-czf', archive, '-C', build, 'd1-omni-text.onnx', 'd1-omni-text-manifest.json', 'd1-omni-src'])
  return { archive, digest: sha256File(archive) }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('isRankerInstalled', () => {
  it('is false on an empty models dir', () => {
    expect(isRankerInstalled(scratch())).toBe(false)
  })

  it('is false when the graph is there but the tokenizer is not', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'd1-omni-text.onnx'), 'graph')
    writeFileSync(join(dir, 'd1-omni-text-manifest.json'), '{}')
    expect(isRankerInstalled(dir)).toBe(false)
  })
})

describe('verifyArchive', () => {
  it('accepts the archive this build expects', () => {
    const { archive, digest } = makeArchive()
    expect(() => verifyArchive(archive, digest)).not.toThrow()
  })

  it('rejects a download that does not match, before anything is unpacked', () => {
    const { archive } = makeArchive()
    const target = scratch()
    expect(() => installRankerArchive(archive, target)).toThrow(/checksum/)
    expect(isRankerInstalled(target)).toBe(false)
  })
})

describe('installRankerArchive', () => {
  it('unpacks the model once and drops the archive', () => {
    const { archive, digest } = makeArchive()
    const target = scratch()

    verifyArchive(archive, digest)
    extractRankerArchive(archive, target)
    expect(isRankerInstalled(target)).toBe(true)

    // installing again is a no-op: nothing is re-downloaded or re-extracted
    installRankerArchive(archive, target, digest)
    expect(isRankerInstalled(target)).toBe(true)
    expect(existsSync(archive)).toBe(false)
  })
})
