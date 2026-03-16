import fs from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

// ── STT model types ───────────────────────────────────────────────────────────
export type SttModelType = 'parakeet' | 'whisper-medium' | 'whisper-large-v3'

// ── Parakeet TDT v3 (default) ─────────────────────────────────────────────────
export const MODEL_DIR = join(app.getPath('home'), '.doty', 'models', 'parakeet-tdt-0.6b-v3-int8')
export const MODEL_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2'

// ── Whisper Medium (multilingual, ~1.5GB) ─────────────────────────────────────
export const WHISPER_MEDIUM_DIR = join(app.getPath('home'), '.doty', 'models', 'sherpa-onnx-whisper-medium')
export const WHISPER_MEDIUM_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-medium.tar.bz2'

// ── Whisper Large-v3 (multilingual, ~1.8GB int8) ─────────────────────────────
export const WHISPER_LARGE_V3_DIR = join(app.getPath('home'), '.doty', 'models', 'sherpa-onnx-whisper-large-v3')
export const WHISPER_LARGE_V3_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-large-v3.tar.bz2'

// Silero VAD v4 model: ~/.doty/models/silero_vad.onnx
// v4 has better accuracy on overlapping speech and lower false-positive rates
export const VAD_MODEL_PATH = join(app.getPath('home'), '.doty', 'models', 'silero_vad.onnx')
export const VAD_MODEL_URL = 'https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx'

// GTCRN speech denoiser: ~/.doty/models/gtcrn_simple.onnx (~48K params, ultra-lightweight)
export const DENOISER_MODEL_PATH = join(app.getPath('home'), '.doty', 'models', 'gtcrn_simple.onnx')
export const DENOISER_MODEL_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/gtcrn_simple.onnx'

export function isModelReady(): boolean {
  return (
    fs.existsSync(join(MODEL_DIR, 'encoder.int8.onnx')) &&
    fs.existsSync(join(MODEL_DIR, 'decoder.int8.onnx')) &&
    fs.existsSync(join(MODEL_DIR, 'joiner.int8.onnx')) &&
    fs.existsSync(join(MODEL_DIR, 'tokens.txt'))
  )
}

export function isWhisperMediumReady(): boolean {
  return (
    fs.existsSync(join(WHISPER_MEDIUM_DIR, 'medium-encoder.int8.onnx')) &&
    fs.existsSync(join(WHISPER_MEDIUM_DIR, 'medium-decoder.int8.onnx')) &&
    fs.existsSync(join(WHISPER_MEDIUM_DIR, 'medium-tokens.txt'))
  )
}

export function isWhisperLargeV3Ready(): boolean {
  return (
    fs.existsSync(join(WHISPER_LARGE_V3_DIR, 'large-v3-encoder.int8.onnx')) &&
    fs.existsSync(join(WHISPER_LARGE_V3_DIR, 'large-v3-decoder.int8.onnx')) &&
    fs.existsSync(join(WHISPER_LARGE_V3_DIR, 'large-v3-tokens.txt'))
  )
}

/** Returns the model dir and URL for a given STT model type */
export function getSttModelInfo(type: SttModelType): { dir: string; url: string; isReady: () => boolean } {
  switch (type) {
    case 'whisper-medium':
      return { dir: WHISPER_MEDIUM_DIR, url: WHISPER_MEDIUM_URL, isReady: isWhisperMediumReady }
    case 'whisper-large-v3':
      return { dir: WHISPER_LARGE_V3_DIR, url: WHISPER_LARGE_V3_URL, isReady: isWhisperLargeV3Ready }
    default:
      return { dir: MODEL_DIR, url: MODEL_URL, isReady: isModelReady }
  }
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
