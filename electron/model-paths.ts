import fs from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { store } from './store'

// ── STT model types ───────────────────────────────────────────────────────────
export type SttModelType =
  | 'parakeet-unified-en'
  | 'nemotron-3.5-streaming'
  | 'nemotron-en-streaming'
  | 'parakeet-tdt-v3'
  | 'voxtral-realtime'

// ── STT Model Registry ────────────────────────────────────────────────────────
export interface SttModelInfo {
  id: SttModelType
  label: string
  description: string
  size: string
  /** Single GGUF filename */
  ggufFile: string
  /** HuggingFace download URL */
  url: string
  /** Whether this model supports streaming */
  streaming: boolean
  /** Languages supported */
  languages: string[]
  isReady: () => boolean
}

const HOME_DIR = app.getPath('home')
const MODELS_DIR = join(HOME_DIR, '.doty', 'models')

export { MODELS_DIR }

export const STT_MODELS: SttModelInfo[] = [
  {
    id: 'parakeet-unified-en',
    label: 'Parakeet Unified EN (streaming)',
    description: 'Best English streaming. 1.6% WER, 160ms–2s latency. GPU-accelerated.',
    size: '731 MB',
    ggufFile: 'parakeet-unified-en-0.6b-Q8_0.gguf',
    url: 'https://huggingface.co/handy-computer/parakeet-unified-en-0.6b-gguf/resolve/main/parakeet-unified-en-0.6b-Q8_0.gguf',
    streaming: true,
    languages: ['en'],
    isReady: () => fs.existsSync(join(MODELS_DIR, 'parakeet-unified-en-0.6b-Q8_0.gguf')),
  },
  {
    id: 'nemotron-3.5-streaming',
    label: 'Nemotron 3.5 Streaming (multilingual)',
    description: 'Multilingual streaming (32 locales incl pt-BR). Cache-aware, 480ms–1s latency.',
    size: '716 MB',
    ggufFile: 'nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf',
    url: 'https://huggingface.co/handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/resolve/main/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf',
    streaming: true,
    languages: ['en', 'pt', 'es', 'fr', 'de', 'it', 'nl', 'ru', 'zh', 'ja', 'ko'],
    isReady: () => fs.existsSync(join(MODELS_DIR, 'nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf')),
  },
  {
    id: 'nemotron-en-streaming',
    label: 'Nemotron EN Streaming (fastest)',
    description: 'English-only streaming. 2.3% WER, 151× realtime on Metal. Lowest latency.',
    size: '696 MB',
    ggufFile: 'nemotron-speech-streaming-en-0.6b-Q8_0.gguf',
    url: 'https://huggingface.co/handy-computer/nemotron-speech-streaming-en-0.6b-gguf/resolve/main/nemotron-speech-streaming-en-0.6b-Q8_0.gguf',
    streaming: true,
    languages: ['en'],
    isReady: () => fs.existsSync(join(MODELS_DIR, 'nemotron-speech-streaming-en-0.6b-Q8_0.gguf')),
  },
  {
    id: 'parakeet-tdt-v3',
    label: 'Parakeet TDT v3 (multilingual batch)',
    description: '25 European languages including Portuguese. Best batch accuracy. No streaming.',
    size: '740 MB',
    ggufFile: 'parakeet-tdt-0.6b-v3-Q8_0.gguf',
    url: 'https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf/resolve/main/parakeet-tdt-0.6b-v3-Q8_0.gguf',
    streaming: false,
    languages: ['en', 'pt', 'es', 'fr', 'de', 'it', 'nl', 'pl', 'ro', 'sv'],
    isReady: () => fs.existsSync(join(MODELS_DIR, 'parakeet-tdt-0.6b-v3-Q8_0.gguf')),
  },
  {
    id: 'voxtral-realtime',
    label: 'Voxtral Mini 4B Realtime',
    description: 'LLM-based streaming ASR. Auto language detect. Larger model, slower.',
    size: '4.73 GB',
    ggufFile: 'Voxtral-Mini-4B-Realtime-2602-Q8_0.gguf',
    url: 'https://huggingface.co/handy-computer/Voxtral-Mini-4B-Realtime-2602-gguf/resolve/main/Voxtral-Mini-4B-Realtime-2602-Q8_0.gguf',
    streaming: true,
    languages: ['auto'],
    isReady: () => fs.existsSync(join(MODELS_DIR, 'Voxtral-Mini-4B-Realtime-2602-Q8_0.gguf')),
  },
]

/** Look up a model by id */
export function getSttModel(id: SttModelType): SttModelInfo {
  return STT_MODELS.find((m) => m.id === id) ?? STT_MODELS[0]
}

/** Get the full path to a model's GGUF file */
export function getModelPath(id: SttModelType): string {
  const model = getSttModel(id)
  return join(MODELS_DIR, model.ggufFile)
}

/** Check if any model is downloaded and selected */
export function isAnySttModelReady(): boolean {
  const selected = store.get('sttModel', '') as string
  if (!selected) return false
  const model = STT_MODELS.find((m) => m.id === selected)
  return model ? model.isReady() : false
}
