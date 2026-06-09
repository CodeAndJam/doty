import fs from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

// ── STT model types ───────────────────────────────────────────────────────────
export type SttModelType = 'parakeet' | 'whisper-medium' | 'whisper-large-v3' | 'voxtral' | 'voxmlx'

// ── STT Model Registry (single source of truth) ──────────────────────────────
// All model metadata lives here. The UI, download logic, and readiness checks
// derive from this registry. To add a new model, add an entry here — the rest
// of the codebase picks it up automatically.
export interface SttModelInfo {
  id: SttModelType
  label: string
  description: string
  size: string
  dir: string
  url: string
  /** 'tar' = download + extract tar.bz2, 'auto' = handled by transformers.js, 'pip' = create venv + pip install */
  downloadMethod: 'tar' | 'auto' | 'pip'
  isReady: () => boolean
}

const HOME_DIR = app.getPath('home')
const MODELS_DIR = join(HOME_DIR, '.doty', 'models')
export const STT_MODELS: SttModelInfo[] = [
  {
    id: 'parakeet',
    label: 'Parakeet TDT v3',
    description: 'Fast, CPU-optimized English model. Best for low-latency transcription.',
    size: '~640 MB',
    dir: join(MODELS_DIR, 'parakeet-tdt-0.6b-v3-int8'),
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2',
    downloadMethod: 'tar',
    isReady: () =>
      fs.existsSync(join(MODELS_DIR, 'parakeet-tdt-0.6b-v3-int8', 'encoder.int8.onnx')) &&
      fs.existsSync(join(MODELS_DIR, 'parakeet-tdt-0.6b-v3-int8', 'decoder.int8.onnx')) &&
      fs.existsSync(join(MODELS_DIR, 'parakeet-tdt-0.6b-v3-int8', 'joiner.int8.onnx')) &&
      fs.existsSync(join(MODELS_DIR, 'parakeet-tdt-0.6b-v3-int8', 'tokens.txt')),
  },
  {
    id: 'whisper-medium',
    label: 'Whisper Medium',
    description: 'Multilingual model supporting 99 languages. Good accuracy.',
    size: '~1.5 GB',
    dir: join(MODELS_DIR, 'sherpa-onnx-whisper-medium'),
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-medium.tar.bz2',
    downloadMethod: 'tar',
    isReady: () =>
      fs.existsSync(join(MODELS_DIR, 'sherpa-onnx-whisper-medium', 'medium-encoder.int8.onnx')) &&
      fs.existsSync(join(MODELS_DIR, 'sherpa-onnx-whisper-medium', 'medium-decoder.int8.onnx')) &&
      fs.existsSync(join(MODELS_DIR, 'sherpa-onnx-whisper-medium', 'medium-tokens.txt')),
  },
  {
    id: 'whisper-large-v3',
    label: 'Whisper Large v3',
    description: 'Best offline accuracy. Multilingual, slower than Parakeet.',
    size: '~1.8 GB',
    dir: join(MODELS_DIR, 'sherpa-onnx-whisper-large-v3'),
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-large-v3.tar.bz2',
    downloadMethod: 'tar',
    isReady: () =>
      fs.existsSync(join(MODELS_DIR, 'sherpa-onnx-whisper-large-v3', 'large-v3-encoder.int8.onnx')) &&
      fs.existsSync(join(MODELS_DIR, 'sherpa-onnx-whisper-large-v3', 'large-v3-decoder.int8.onnx')) &&
      fs.existsSync(join(MODELS_DIR, 'sherpa-onnx-whisper-large-v3', 'large-v3-tokens.txt')),
  },
  {
    id: 'voxtral',
    label: 'Voxtral Mini 4B Realtime',
    description: 'LLM-based realtime ASR. 13 languages, <500ms latency. Auto-downloads on first use.',
    size: '~2 GB',
    dir: join(HOME_DIR, '.doty', 'hf-cache'),
    url: '',
    downloadMethod: 'auto',
    isReady: () => true, // auto-downloaded by transformers.js on first use
  },
  {
    id: 'voxmlx',
    label: 'Voxtral MLX (GPU)',
    description: 'Voxtral 4B via MLX — uses Apple Silicon GPU. Auto-installs Python env.',
    size: '~3 GB',
    dir: join(HOME_DIR, '.doty', 'voxmlx-env'),
    url: '',
    downloadMethod: 'pip',
    isReady: () => {
      try {
        const { execSync } = require('node:child_process')
        const venvPy = join(HOME_DIR, '.doty', 'voxmlx-env', 'bin', 'python3')
        if (!fs.existsSync(venvPy)) return false
        execSync(`${venvPy} -c "import voxmlx"`, { stdio: 'ignore' })
        return true
      } catch {
        return false
      }
    },
  },
]

/** Look up a model by id */
function getSttModel(id: SttModelType): SttModelInfo {
  return STT_MODELS.find((m) => m.id === id) ?? STT_MODELS[0]
}

// ── Legacy exports (used by asr.ts, main.ts) ─────────────────────────────────
export const MODEL_DIR = getSttModel('parakeet').dir
const MODEL_URL = getSttModel('parakeet').url
export const WHISPER_MEDIUM_DIR = getSttModel('whisper-medium').dir
const WHISPER_MEDIUM_URL = getSttModel('whisper-medium').url
export const WHISPER_LARGE_V3_DIR = getSttModel('whisper-large-v3').dir
const WHISPER_LARGE_V3_URL = getSttModel('whisper-large-v3').url
const VOXTRAL_MODEL_ID = 'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX'
const VOXTRAL_CACHE_DIR = getSttModel('voxtral').dir

function isModelReady(): boolean {
  return getSttModel('parakeet').isReady()
}
function isWhisperMediumReady(): boolean {
  return getSttModel('whisper-medium').isReady()
}
function isWhisperLargeV3Ready(): boolean {
  return getSttModel('whisper-large-v3').isReady()
}

// Silero VAD v4 model
export const VAD_MODEL_PATH = join(MODELS_DIR, 'silero_vad.onnx')
export const VAD_MODEL_URL = 'https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx'

// GTCRN speech denoiser
export const DENOISER_MODEL_PATH = join(MODELS_DIR, 'gtcrn_simple.onnx')
export const DENOISER_MODEL_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/gtcrn_simple.onnx'

/** Returns the model dir and URL for a given STT model type */
export function getSttModelInfo(type: SttModelType): { dir: string; url: string; isReady: () => boolean } {
  const m = getSttModel(type)
  return { dir: m.dir, url: m.url, isReady: m.isReady }
}

export function isVadReady(): boolean {
  return fs.existsSync(VAD_MODEL_PATH)
}

export function isDenoiserReady(): boolean {
  return fs.existsSync(DENOISER_MODEL_PATH)
}

/** Default hotwords file path: ~/.doty/hotwords.txt */
export const DEFAULT_HOTWORDS_PATH = join(app.getPath('home'), '.doty', 'hotwords.txt')

// Reranker model cache: ~/.doty/hf-cache/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1/
const RERANKER_CACHE_DIR = join(
  app.getPath('home'),
  '.doty',
  'hf-cache',
  'cross-encoder',
  'mmarco-mMiniLMv2-L12-H384-v1',
)

export function isRerankerCached(): boolean {
  try {
    return fs.existsSync(join(RERANKER_CACHE_DIR, 'onnx', 'model.onnx'))
  } catch {
    return false
  }
}
