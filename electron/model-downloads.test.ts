import { describe, expect, it, vi } from 'vitest'
import { createModelDownloads, type DownloadEvent } from './model-downloads'

const MODEL = { id: 'nemotron', url: 'https://example.test/model.gguf' }
const DEST = '/models/model.gguf'

type Progress = (percent: number, downloadedMB: number, totalMB: number) => void
type Download = (url: string, dest: string, onProgress?: Progress, options?: { signal?: AbortSignal }) => Promise<void>

function harness(download: Download) {
  const events: DownloadEvent[] = []
  const downloads = createModelDownloads({ download, onEvent: (e) => events.push(e) })
  return { downloads, events }
}

describe('model downloads', () => {
  it('reports progress and completion', async () => {
    const download = vi.fn<Download>(async (_url, _dest, onProgress) => {
      onProgress?.(40, 4, 10)
    })
    const { downloads, events } = harness(download)

    await expect(downloads.start(MODEL, DEST)).resolves.toEqual({ ok: true })

    expect(download).toHaveBeenCalledWith(MODEL.url, DEST, expect.any(Function), expect.anything())
    expect(events).toEqual([
      { type: 'progress', modelId: 'nemotron', percent: 40, downloadedMB: 4, totalMB: 10 },
      { type: 'done', modelId: 'nemotron' },
    ])
    expect(downloads.state()).toEqual({ downloading: null, error: null })
  })

  it('refuses a second download while one is running', async () => {
    let release = () => {}
    const download: Download = () => new Promise<void>((resolve) => (release = resolve))
    const { downloads } = harness(download)

    const first = downloads.start(MODEL, DEST)
    await expect(downloads.start(MODEL, DEST)).resolves.toEqual({
      ok: false,
      reason: 'download already in progress',
    })

    release()
    await expect(first).resolves.toEqual({ ok: true })
  })

  it('cancels the running download and says so', async () => {
    const download: Download = (_url, _dest, _onProgress, options) =>
      new Promise<void>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('Download cancelled')))
      })
    const { downloads, events } = harness(download)

    const started = downloads.start(MODEL, DEST)
    downloads.cancel()

    await expect(started).resolves.toEqual({ ok: false, reason: 'cancelled' })
    expect(events[events.length - 1]).toEqual({ type: 'cancelled', modelId: 'nemotron' })
    expect(downloads.state().downloading).toBeNull()
  })

  it('keeps the failure in state until the next attempt', async () => {
    const download = vi.fn<Download>(async () => {
      throw new Error('HTTP 404')
    })
    const { downloads, events } = harness(download)

    await expect(downloads.start(MODEL, DEST)).resolves.toEqual({ ok: false, reason: 'HTTP 404' })
    expect(events[events.length - 1]).toEqual({ type: 'error', modelId: 'nemotron', error: 'HTTP 404' })
    expect(downloads.state()).toEqual({
      downloading: null,
      error: { modelId: 'nemotron', error: 'HTTP 404' },
    })
  })
})
