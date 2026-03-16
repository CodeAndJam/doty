import fs from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

// Model dir: ~/.doty/models/parakeet-tdt-0.6b-v3-int8/
export const MODEL_DIR = join(app.getPath('home'), '.doty', 'models', 'parakeet-tdt-0.6b-v3-int8')
export const MODEL_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2'

// Silero VAD model: ~/.doty/models/silero_vad.onnx
export const VAD_MODEL_PATH = join(app.getPath('home'), '.doty', 'models', 'silero_vad.onnx')
export const VAD_MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx'

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

export function isVadReady(): boolean {
  return fs.existsSync(VAD_MODEL_PATH)
}

export function isDenoiserReady(): boolean {
  return fs.existsSync(DENOISER_MODEL_PATH)
}

/** Default hotwords file path: ~/.doty/hotwords.txt */
export const DEFAULT_HOTWORDS_PATH = join(app.getPath('home'), '.doty', 'hotwords.txt')

// Reranker model cache: ~/.doty/hf-cache/Xenova/ms-marco-MiniLM-L-6-v2/
const RERANKER_CACHE_DIR = join(app.getPath('home'), '.doty', 'hf-cache', 'Xenova', 'ms-marco-MiniLM-L-6-v2')

export function isRerankerCached(): boolean {
  try {
    return fs.existsSync(join(RERANKER_CACHE_DIR, 'onnx', 'model_q4.onnx'))
  } catch {
    return false
  }
}
