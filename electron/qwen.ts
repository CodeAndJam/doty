import { join } from 'path'
import type { TrackMetadata } from './analyzer'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PipelineFn = (...args: any[]) => Promise<any>

// ── In-process inference (HuggingFace official pattern) ──────────────────────
// The official transformers.js Electron example runs the model directly in the
// main process via ipcMain.handle — no worker, no child process.
// With onnxruntime-node ≥1.22 the SIGTRAP on Apple Silicon is fixed, so we
// follow the same pattern here.

const MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX'

let _onStatus: ((status: 'loading' | 'ready') => void) | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _generatorPromise: Promise<any> | null = null

/** Register a callback to receive model load status updates. */
export function onQwenStatus(cb: (status: 'loading' | 'ready') => void) {
  _onStatus = cb
}

/** No-op — kept for API compatibility with main.ts */
export function killQwenChild() { /* nothing to kill */ }

function getGenerator() {
  if (_generatorPromise) return _generatorPromise

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron')
  // app.getAppPath() returns the directory containing package.json.
  // In dev/built mode that is the project root; in packaged .app it is
  // the asar root. Either way node_modules sits alongside it.
  // However electron-vite sets appPath to out/main in some modes, so
  // walk up until we find node_modules.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs')
  let appPath = app.getAppPath()
  while (appPath !== require('path').dirname(appPath)) {
    if (fs.existsSync(join(appPath, 'node_modules/@huggingface/transformers'))) break
    appPath = require('path').dirname(appPath)
  }
  const homePath = app.getPath('home')
  const transformersPath = join(appPath, 'node_modules/@huggingface/transformers/dist/transformers.node.cjs')
  console.log('[qwen] resolved appPath:', appPath)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pipeline, env } = require(transformersPath)
  env.cacheDir = join(homePath, '.doty', 'hf-cache')
  env.allowRemoteModels = true

  console.log('[qwen] loading model in main process...')
  _onStatus?.('loading')

  _generatorPromise = pipeline('text-generation', MODEL_ID, { dtype: 'q4', device: 'cpu' })
    .then((gen: unknown) => {
      console.log('[qwen] model ready')
      _onStatus?.('ready')
      return gen
    })
    .catch((err: unknown) => {
      console.error('[qwen] model load failed:', err)
      _generatorPromise = null
      throw err
    })

  return _generatorPromise
}

function formatTrack(filename: string, meta: TrackMetadata | null, index: number): string {
  if (!meta) return `${index + 1}. ${filename}`
  const key = meta.scale === 'minor' ? `${meta.key}m` : meta.key
  return `${index + 1}. ${filename} — BPM: ${meta.bpm}, Key: ${key}, Danceability: ${meta.danceability}, Energy: ${meta.energy}`
}

export class QwenManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private generator: any = null
  private readonly pipelineFn: PipelineFn | null

  /** Pass a mock pipelineFn in tests to avoid loading Electron/transformers. */
  constructor(pipelineFn?: PipelineFn) {
    this.pipelineFn = pipelineFn ?? null
  }

  private async loadGenerator() {
    if (this.generator) return this.generator
    if (!this.pipelineFn) throw new Error('loadGenerator called without pipelineFn')
    console.log('[qwen] Loading recommendation model...')
    this.generator = await this.pipelineFn('text-generation', MODEL_ID, { dtype: 'q4', device: 'cpu' })
    console.log('[qwen] Model ready')
    return this.generator
  }

  async recommend(
    transcript: string,
    files: string[],
    metadata: Record<string, TrackMetadata> = {},
  ): Promise<string[]> {
    if (files.length === 0) return []

    try {
      const messages = [
        {
          role: 'system',
          content:
            'You are a music mood matcher. Given a conversation transcript and a list of songs with audio features, pick the 5 best matching songs. Return ONLY a valid JSON array of exactly 5 filenames from the provided list. No explanation, no markdown, no code block.',
        },
        {
          role: 'user',
          content: `Transcript:\n"${transcript.slice(0, 600)}"\n\nSong list:\n${files
            .slice(0, 100)
            .map((f, i) => formatTrack(f, metadata[f] ?? null, i))
            .join('\n')}\n\nReturn a JSON array of 5 filenames.`,
        },
      ]

      const genOptions = {
        max_new_tokens: 150,
        temperature: 0.3,
        do_sample: true,
        thinking: false,
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let output: any
      if (this.pipelineFn) {
        // test path — use mock pipeline
        const gen = await this.loadGenerator()
        output = await gen(messages, genOptions)
      } else {
        // production path — run in main process (HuggingFace official pattern)
        const gen = await getGenerator()
        console.log('[qwen] running inference...')
        output = await gen(messages, genOptions)
        console.log('[qwen] inference done')
      }

      const text: string = output?.[0]?.generated_text?.at(-1)?.content ?? ''
      console.log('[qwen] raw output:', text.slice(0, 500))

      const match = text.match(/\[[\s\S]*\]/)
      if (!match) {
        console.log('[qwen] no JSON array found, falling back')
        return files.slice(0, 5)
      }

      const parsed: string[] = JSON.parse(match[0])
      const normalised = parsed.map((f) => f.replace(/^\d+\.\s*/, '').trim())
      const valid = normalised.filter((f) => files.includes(f)).slice(0, 5)
      console.log('[qwen] valid recommendations:', valid.length)
      return valid.length > 0 ? valid : files.slice(0, 5)
    } catch (e) {
      console.error('[qwen] recommend error:', e)
      return files.slice(0, 5)
    }
  }
}
