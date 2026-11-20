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
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { join } from 'node:path'
import type { DownloadFn } from './model-downloads'

const REPO = 'https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/main'

export const EMBEDDER_FILES = [
  {
    name: 'config.json',
    sha256: '8d011bfe08b5e345bbe0b81e5c6fd02c381920b345b986047bc2a33ce7b90d1d',
    path: 'config.json',
  },
  {
    name: 'tokenizer.json',
    sha256: '4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4',
    path: 'tokenizer.json',
  },
  {
    name: 'tokenizer_config.json',
    sha256: '17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874',
    path: 'tokenizer_config.json',
  },
  {
    name: 'model_q4.onnx',
    sha256: 'f9eeba97acddf139b8ee2ddf04bc30dceafa88de93fadf74d7644e0d61a477a9',
    path: 'onnx/model_q4.onnx',
  },
  {
    name: 'model_q4.onnx_data',
    sha256: 'c3975f2d1ab7a1878ae31a7d7a9b7804a827aff3800b60dfceafce21cac3df49',
    path: 'onnx/model_q4.onnx_data',
  },
  {
    name: 'audio_encoder_q4.onnx',
    sha256: 'c4cce3370e72262280d00293cac038896050a03a8e9a27e10b061ca97510296e',
    path: 'onnx/audio_encoder_q4.onnx',
  },
  {
    name: 'audio_encoder_q4.onnx_data',
    sha256: 'ba9328e6341360974083085b44b2bba265003bda564740f7c4c23ed9928f17e2',
    path: 'onnx/audio_encoder_q4.onnx_data',
  },
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
  /** Tests write dummy bytes; the shipped path always verifies. */
  verify = true,
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
    if (verify && fs.existsSync(dest)) {
      const digest = createHash('sha256').update(fs.readFileSync(dest)).digest('hex')
      if (digest !== file.sha256) {
        fs.rmSync(dest, { force: true })
        throw new Error(`embedder file ${file.name} failed its checksum (${digest})`)
      }
    }
  }
  const missing = EMBEDDER_FILES.filter((file) => !present(join(dir, file.name)))
  if (missing.length > 0) {
    throw new Error(`embedder incomplete: ${missing.map((file) => file.name).join(', ')}`)
  }
  onProgress?.(100)
}
