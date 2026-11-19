/**
 * EmbeddingGemma 2 (ONNX, q4) — the embedder behind semantic search and the
 * audio lane verdict.
 *
 * Seven files from `onnx-community/embeddinggemma-2-ONNX`, ~378 MiB. They are
 * fetched one at a time through the shared downloader, which resumes and locks
 * each file, so a dropped connection costs only the file in flight. Names are
 * flattened into the model directory because that is how the loader looks them
 * up.
 */
import fs from 'node:fs'
import { join } from 'node:path'
import type { DownloadFn } from './model-downloads'

const REPO = 'https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/main'

export const EMBEDDER_FILES = [
  { name: 'config.json', path: 'config.json' },
  { name: 'tokenizer.json', path: 'tokenizer.json' },
  { name: 'tokenizer_config.json', path: 'tokenizer_config.json' },
  { name: 'model_q4.onnx', path: 'onnx/model_q4.onnx' },
  { name: 'model_q4.onnx_data', path: 'onnx/model_q4.onnx_data' },
  { name: 'audio_encoder_q4.onnx', path: 'onnx/audio_encoder_q4.onnx' },
  { name: 'audio_encoder_q4.onnx_data', path: 'onnx/audio_encoder_q4.onnx_data' },
] as const

function present(path: string): boolean {
  try {
    return fs.statSync(path).size > 1024
  } catch {
    return false
  }
}

/** Fetch whichever of the seven files are missing. Existing files are never refetched. */
export async function downloadEmbedder(
  download: DownloadFn,
  dir: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  fs.mkdirSync(dir, { recursive: true })
  for (const [index, file] of EMBEDDER_FILES.entries()) {
    const dest = join(dir, file.name)
    if (present(dest)) continue
    await download(
      `${REPO}/${file.path}`,
      dest,
      (percent) => onProgress?.(Math.round(((index + percent / 100) / EMBEDDER_FILES.length) * 100)),
      { signal },
    )
  }
  const missing = EMBEDDER_FILES.filter((file) => !present(join(dir, file.name)))
  if (missing.length > 0) {
    throw new Error(`embedder incomplete: ${missing.map((file) => file.name).join(', ')}`)
  }
  onProgress?.(100)
}
