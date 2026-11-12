/**
 * reranker-worker.ts — worker_threads worker for the multilingual cross-encoder.
 * Keeps ONNX inference off the Electron main process.
 */
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { AutoModelForSequenceClassification, AutoTokenizer, env } from '@huggingface/transformers'

const { homePath } = workerData as { homePath: string }
const MODEL_ID = 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1'

env.cacheDir = join(homePath, '.doty', 'hf-cache')
env.allowRemoteModels = true

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tokenizer: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any = null
let loading: Promise<void> | null = null

function load(): Promise<void> {
  if (tokenizer && model) return Promise.resolve()
  if (loading) return loading
  loading = (async () => {
    ;[tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID),
      AutoModelForSequenceClassification.from_pretrained(MODEL_ID, { device: 'cpu', dtype: 'fp32' }),
    ])
  })()
  return loading
}

load().then(
  () => parentPort!.postMessage({ type: 'ready' }),
  (e) => parentPort!.postMessage({ type: 'fatal', error: e instanceof Error ? e.message : String(e) }),
)

parentPort!.on(
  'message',
  async (msg: { type: string; id?: number; pairs?: Array<{ text: string; text_pair: string }> }) => {
    if (msg.type !== 'score' || msg.id === undefined) return
    try {
      await load()
      const pairs = msg.pairs ?? []
      const inputs = tokenizer(
        pairs.map((p) => p.text),
        {
          text_pair: pairs.map((p) => p.text_pair),
          padding: true,
          truncation: true,
        },
      )
      const { logits } = await model(inputs)
      parentPort!.postMessage({ type: 'scores', id: msg.id, scores: Array.from(logits.data as Float32Array) })
    } catch (e) {
      parentPort!.postMessage({ type: 'score-error', id: msg.id, error: e instanceof Error ? e.message : String(e) })
    }
  },
)
