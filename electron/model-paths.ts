import { join } from 'path'
import { app } from 'electron'
import fs from 'fs'

// Model dir: ~/.doty/models/parakeet-tdt-0.6b-v3-int8/
export const MODEL_DIR = join(app.getPath('home'), '.doty', 'models', 'parakeet-tdt-0.6b-v3-int8')
export const MODEL_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2'

export function isModelReady(): boolean {
  return (
    fs.existsSync(join(MODEL_DIR, 'encoder.int8.onnx')) &&
    fs.existsSync(join(MODEL_DIR, 'decoder.int8.onnx')) &&
    fs.existsSync(join(MODEL_DIR, 'joiner.int8.onnx')) &&
    fs.existsSync(join(MODEL_DIR, 'tokens.txt'))
  )
}

// Reranker model cache: ~/.doty/hf-cache/Xenova/ms-marco-MiniLM-L-6-v2/
const RERANKER_CACHE_DIR = join(app.getPath('home'), '.doty', 'hf-cache', 'Xenova', 'ms-marco-MiniLM-L-6-v2')

export function isRerankerCached(): boolean {
  try {
    return fs.existsSync(join(RERANKER_CACHE_DIR, 'onnx', 'model_q4.onnx'))
  } catch {
    return false
  }
}
