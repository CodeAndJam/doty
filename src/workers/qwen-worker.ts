/**
 * qwen-worker.ts — Renderer Web Worker (IIFE format)
 * Uses @huggingface/transformers with mmarco-mMiniLMv2-L12-H384-v1 as a
 * multilingual cross-encoder. Scores (transcript, track_description) pairs
 * for relevance. Trained on mMARCO (14 languages including Portuguese).
 *
 * Uses AutoTokenizer + AutoModelForSequenceClassification directly (not the
 * text-classification pipeline) to extract raw logits — the pipeline applies
 * softmax which always returns 1.0 for single-label cross-encoders.
 *
 * The model is pre-downloaded by the main process to avoid fetch stalls in
 * Electron's sandboxed worker context. The worker loads from local cache only.
 */
import { AutoModelForSequenceClassification, AutoTokenizer, env } from '@huggingface/transformers'

const t0 = Date.now()
const elapsed = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`

function log(...args: unknown[]) {
  const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(`[reranker-worker ${elapsed()}]`, ...args)
  self.postMessage({ type: 'log', message: msg })
}

function logError(...args: unknown[]) {
  const msg = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ')
  console.error(`[reranker-worker ${elapsed()}]`, ...args)
  self.postMessage({ type: 'log', message: `ERROR: ${msg}` })
}

log('starting, location:', self.location.href)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wasmEnv: any
try {
  wasmEnv = (env.backends as any).onnx.wasm
  log('env.backends.onnx.wasm found')
} catch (e) {
  logError('failed to access env.backends.onnx.wasm:', e)
  try {
    wasmEnv = (env as any).backends?.onnx?.wasm
    log('fallback env path worked')
  } catch (e2) {
    logError('fallback also failed:', e2)
  }
}

if (wasmEnv) {
  wasmEnv.proxy = false
  wasmEnv.numThreads = 1
  log('set proxy=false, numThreads=1')

  const wasmUrl = new URL('/ort-wasm-simd-threaded.asyncify.wasm', self.location.origin).href
  log('wasmPaths.wasm =', wasmUrl)
  wasmEnv.wasmPaths = { wasm: wasmUrl }
} else {
  logError('wasmEnv is null — WASM config not applied!')
}

env.useFSCache = true
log('useFSCache = true')
log('env.cacheDir =', env.cacheDir)
log('env.allowLocalModels =', env.allowLocalModels)
log('env.allowRemoteModels =', env.allowRemoteModels)

const MODEL_ID = 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let modelPromise: Promise<{ tokenizer: any; model: any }> | null = null

function getReranker() {
  if (!modelPromise) {
    self.postMessage({ type: 'status', status: 'loading' })
    log('loading AutoTokenizer + AutoModelForSequenceClassification for', MODEL_ID)

    const progressCb = (progress: unknown) => {
      const p = progress as Record<string, unknown>
      if (p.status === 'download' || p.status === 'progress') {
        const pct = typeof p.progress === 'number' ? `${p.progress.toFixed(1)}%` : ''
        const file = p.file ?? p.name ?? ''
        log(`[${p.status}] ${file} ${pct}`)
        self.postMessage({ type: 'progress', ...p })
      } else if (p.status === 'done') {
        log(`[done] ${p.file ?? p.name ?? 'file'} loaded`)
        self.postMessage({ type: 'progress', ...p })
      } else if (p.status === 'initiate') {
        log(`[initiate] ${p.file ?? p.name ?? 'file'} — starting download/cache check`)
        self.postMessage({ type: 'progress', ...p })
      } else if (p.status === 'ready') {
        log('[ready] model file ready')
      } else {
        log('[progress]', JSON.stringify(p))
      }
    }

    modelPromise = Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback: progressCb }),
      AutoModelForSequenceClassification.from_pretrained(MODEL_ID, {
        device: 'wasm',
        progress_callback: progressCb,
      }),
    ])
      .then(([tokenizer, model]) => {
        log('model ready — reranker loaded successfully')
        self.postMessage({ type: 'status', status: 'ready' })
        return { tokenizer, model }
      })
      .catch((err) => {
        logError('model load FAILED:', err)
        logError('error name:', (err as Error)?.name, 'message:', (err as Error)?.message)
        if ((err as Error)?.stack) logError('stack:', (err as Error).stack)
        self.postMessage({ type: 'status', status: 'error', message: String(err) })
        modelPromise = null
        throw err
      })
  }
  return modelPromise
}

// Start loading immediately when the worker is created
log('calling getReranker() to start model load...')
getReranker().catch(() => {
  /* error already logged above */
})

/**
 * Message protocol:
 *   Request:  { id, pairs: Array<{ text: string, text_pair: string }> }
 *   Response: { id, output: number[] }  — raw logit scores, one per pair
 */
self.onmessage = async (e: MessageEvent) => {
  const { id, pairs } = e.data as { id: number; pairs: Array<{ text: string; text_pair: string }> }
  log('received rerank request id=', id, 'pairs=', pairs.length)
  try {
    const { tokenizer, model } = await getReranker()
    const queries = pairs.map((p) => p.text)
    const passages = pairs.map((p) => p.text_pair)
    const inputs = tokenizer(queries, { text_pair: passages, padding: true, truncation: true })
    const { logits } = await model(inputs)
    const scores: number[] = Array.from(logits.data as Float32Array)
    log('rerank complete for id=', id)
    self.postMessage({ id, output: scores })
  } catch (err) {
    logError('rerank error for id=', id, ':', err)
    self.postMessage({ id, error: String(err) })
  }
}
