import type { DownloadOptions } from './download-file'

/** The part of a model registry entry a download needs. */
export interface DownloadableModel {
  id: string
  url: string
}

export type DownloadFn = (
  url: string,
  destPath: string,
  onProgress?: (percent: number, downloadedMB: number, totalMB: number) => void,
  options?: DownloadOptions,
) => Promise<void>

export type DownloadEvent =
  | { type: 'progress'; modelId: string; percent: number; downloadedMB: number; totalMB: number }
  | { type: 'done'; modelId: string }
  | { type: 'cancelled'; modelId: string }
  | { type: 'error'; modelId: string; error: string }

export interface DownloadState {
  downloading: { modelId: string; percent: number } | null
  error: { modelId: string; error: string } | null
}

export interface ModelDownloads {
  start(model: DownloadableModel, destPath: string): Promise<{ ok: boolean; reason?: string }>
  cancel(): void
  state(): DownloadState
}

/**
 * One download state machine for every model kind. Callers map the emitted
 * events onto their own channels; readiness and model loading stay outside.
 */
export function createModelDownloads(deps: {
  download: DownloadFn
  onEvent: (event: DownloadEvent) => void
}): ModelDownloads {
  let downloading: DownloadState['downloading'] = null
  let error: DownloadState['error'] = null
  let abort: AbortController | null = null

  return {
    async start(model, destPath) {
      if (downloading) return { ok: false, reason: 'download already in progress' }

      const controller = new AbortController()
      abort = controller
      downloading = { modelId: model.id, percent: 0 }
      error = null

      try {
        await deps.download(
          model.url,
          destPath,
          (percent, downloadedMB, totalMB) => {
            downloading = { modelId: model.id, percent }
            deps.onEvent({ type: 'progress', modelId: model.id, percent, downloadedMB, totalMB })
          },
          { signal: controller.signal },
        )
        deps.onEvent({ type: 'done', modelId: model.id })
        return { ok: true }
      } catch (e) {
        if (controller.signal.aborted) {
          deps.onEvent({ type: 'cancelled', modelId: model.id })
          return { ok: false, reason: 'cancelled' }
        }
        error = { modelId: model.id, error: e instanceof Error ? e.message : String(e) }
        deps.onEvent({ type: 'error', modelId: model.id, error: error.error })
        return { ok: false, reason: error.error }
      } finally {
        downloading = null
        abort = null
      }
    },
    cancel() {
      abort?.abort()
    },
    state() {
      return { downloading, error }
    },
  }
}
