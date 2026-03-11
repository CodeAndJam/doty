/**
 * qwen-worker.ts
 * Persistent worker thread for ms-marco-MiniLM-L-6-v2 inference.
 * Receives { id, pairs } messages, posts back { id, output: number[] } or { id, error }.
 */
import { workerData, parentPort } from 'worker_threads'
import { join } from 'path'

const { appPath, homePath } = workerData as { appPath: string; homePath: string }

const MODEL_ID = 'Xenova/ms-marco-MiniLM-L-6-v2'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tokenizer: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any = null

async function loadReranker() {
  if (tokenizer && model) return
  console.log('[reranker-worker] Loading recommendation model...')
  parentPort!.postMessage({ type: 'status', status: 'loading' })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AutoTokenizer, AutoModelForSequenceClassification, env } = require(
    join(appPath, 'node_modules/@huggingface/transformers/dist/transformers.node.cjs')
  )
  env.cacheDir = join(homePath, '.doty', 'hf-cache')
  env.allowRemoteModels = true
  ;[tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(MODEL_ID),
    AutoModelForSequenceClassification.from_pretrained(MODEL_ID, { device: 'cpu', dtype: 'q4' }),
  ])
  console.log('[reranker-worker] Model ready')
  parentPort!.postMessage({ type: 'status', status: 'ready' })
}

parentPort!.on('message', async ({ id, pairs }: { id: number; pairs: Array<{ text: string; text_pair: string }> }) => {
  try {
    await loadReranker()
    const queries = pairs.map(p => p.text)
    const passages = pairs.map(p => p.text_pair)
    const inputs = tokenizer(queries, { text_pair: passages, padding: true, truncation: true })
    const { logits } = await model(inputs)
    const scores: number[] = Array.from(logits.data as Float32Array)
    parentPort!.postMessage({ id, output: scores })
  } catch (e) {
    parentPort!.postMessage({ id, error: String(e) })
  }
})
