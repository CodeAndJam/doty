// @vitest-environment node
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { downloadEmbedder, EMBEDDER_FILES } from './embedder-model'
import type { DownloadFn } from './model-downloads'

const dirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(join(tmpdir(), 'doty-embedder-'))
  dirs.push(dir)
  return dir
}

function fakeDownload(writes = true): DownloadFn {
  return async (_url, dest, onProgress) => {
    if (!writes) return
    fs.writeFileSync(dest, Buffer.alloc(2048))
    onProgress?.(100, 0, 0)
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('downloadEmbedder', () => {
  it('fetches every missing file and reports completion', async () => {
    const dir = tempDir()
    const urls: string[] = []
    const download: DownloadFn = async (url, dest, onProgress) => {
      urls.push(url)
      fs.writeFileSync(dest, Buffer.alloc(2048))
      onProgress?.(100, 0, 0)
    }
    let percent = 0

    await downloadEmbedder(download, dir, (p) => {
      percent = p
    })

    expect(urls).toHaveLength(EMBEDDER_FILES.length)
    expect(urls[0]).toContain('embeddinggemma-2-ONNX')
    expect(fs.readdirSync(dir).sort()).toEqual(EMBEDDER_FILES.map((file) => file.name).sort())
    expect(percent).toBe(100)
  })

  it('does not refetch a file already on disk', async () => {
    const dir = tempDir()
    fs.writeFileSync(join(dir, 'model_q4.onnx'), Buffer.alloc(2048))
    const urls: string[] = []
    const download: DownloadFn = async (url, dest) => {
      urls.push(url)
      fs.writeFileSync(dest, Buffer.alloc(2048))
    }

    await downloadEmbedder(download, dir)

    expect(urls.some((url) => url.endsWith('/onnx/model_q4.onnx'))).toBe(false)
    expect(urls).toHaveLength(EMBEDDER_FILES.length - 1)
  })

  it('fails when the downloader reports success without writing the files', async () => {
    await expect(downloadEmbedder(fakeDownload(false), tempDir())).rejects.toThrow(/incomplete/)
  })
})
