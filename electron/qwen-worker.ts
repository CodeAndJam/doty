/**
 * qwen-worker.ts
 * Persistent worker thread for Qwen3 inference.
 * Receives { id, messages, options } messages, posts back { id, output } or { id, error }.
 * Running in a worker gives the ONNX runtime its own memory space, avoiding OOM
 * crashes in the main process when both ASR and the LLM are loaded simultaneously.
 */
import { workerData, parentPort } from 'worker_threads'
import { join } from 'path'

const { appPath, homePath } = workerData as { appPath: string; homePath: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generator: any = null

async function loadGenerator() {
  if (generator) return generator
  console.log('[qwen-worker] Loading recommendation model...')
  parentPort!.postMessage({ type: 'status', status: 'loading' })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pipeline, env } = require(
    join(appPath, 'node_modules/@huggingface/transformers/dist/transformers.node.cjs')
  )
  env.cacheDir = join(homePath, '.doty', 'hf-cache')
  env.allowRemoteModels = true
  generator = await pipeline('text-generation', 'onnx-community/Qwen3-0.6B-ONNX', {
    dtype: 'q4',
    device: 'cpu',
  })
  console.log('[qwen-worker] Model ready')
  parentPort!.postMessage({ type: 'status', status: 'ready' })
  return generator
}

parentPort!.on('message', async ({ id, messages, options }: { id: number; messages: unknown[]; options: unknown }) => {
  try {
    const gen = await loadGenerator()
    const output = await gen(messages, options)
    parentPort!.postMessage({ id, output })
  } catch (e) {
    parentPort!.postMessage({ id, error: String(e) })
  }
})
