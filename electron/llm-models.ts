import fs from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

// ── Scene Interpreter LLM Models ──────────────────────────────────────────────
export type LlmModelType = 'qwen3-0.6b' | 'bonsai-1.7b' | 'gemma4-e2b'

export interface LlmModelInfo {
  id: LlmModelType
  label: string
  description: string
  size: string
  ggufFile: string
  url: string
  isReady: () => boolean
}

const HOME_DIR = app.getPath('home')
const MODELS_DIR = join(HOME_DIR, '.doty', 'models')

export const LLM_MODELS: LlmModelInfo[] = [
  {
    id: 'qwen3-0.6b',
    label: 'Qwen3 0.6B (fastest)',
    description: 'Smallest scene interpreter. Fast, good for extraction tasks. ~80 tok/s on Apple Silicon.',
    size: '400 MB',
    ggufFile: 'Qwen3-0.6B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf',
    isReady: () => fs.existsSync(join(MODELS_DIR, 'Qwen3-0.6B-Q4_K_M.gguf')),
  },
  {
    id: 'bonsai-1.7b',
    label: 'Bonsai 1.7B (1-bit, efficient)',
    description: '1-bit quantized, 130 tok/s on M4. Excellent quality-per-byte ratio.',
    size: '270 MB',
    ggufFile: 'Bonsai-1.7B-Q1_0_g128.gguf',
    url: 'https://huggingface.co/prism-ml/Bonsai-1.7B-gguf/resolve/main/Bonsai-1.7B-Q1_0_g128.gguf',
    isReady: () => fs.existsSync(join(MODELS_DIR, 'Bonsai-1.7B-Q1_0_g128.gguf')),
  },
  {
    id: 'gemma4-e2b',
    label: 'Gemma 4 E2B (best quality)',
    description: 'Google DeepMind edge model. Best scene understanding, larger footprint.',
    size: '1.5 GB',
    ggufFile: 'gemma-4-E2B-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf',
    isReady: () => fs.existsSync(join(MODELS_DIR, 'gemma-4-E2B-it-Q4_K_M.gguf')),
  },
]

// ── Embedding Model ───────────────────────────────────────────────────────────
export const EMBEDDING_MODEL = {
  id: 'nomic-embed-v2',
  label: 'Nomic Embed Text v2 (multilingual)',
  ggufFile: 'nomic-embed-text-v2-moe-Q8_0.gguf',
  url: 'https://huggingface.co/nomic-ai/nomic-embed-text-v2-moe-GGUF/resolve/main/nomic-embed-text-v2-moe-Q8_0.gguf',
  size: '487 MB',
  isReady: () => fs.existsSync(join(MODELS_DIR, 'nomic-embed-text-v2-moe-Q8_0.gguf')),
}

export function getLlmModel(id: LlmModelType): LlmModelInfo {
  return LLM_MODELS.find((m) => m.id === id) ?? LLM_MODELS[0]
}

export function getLlmModelPath(id: LlmModelType): string {
  return join(MODELS_DIR, getLlmModel(id).ggufFile)
}

export function getEmbeddingModelPath(): string {
  return join(MODELS_DIR, EMBEDDING_MODEL.ggufFile)
}
