/**
 * qwen-child.ts
 * Runs as an Electron utilityProcess child.
 * Must use process.parentPort (not process.send) for IPC.
 */
import { join } from 'path'

const { appPath, homePath } = process.env as { appPath: string; homePath: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generator: any = null

async function loadGenerator() {
  if (generator) return generator
  console.log('[qwen-child] Loading recommendation model...')
  process.parentPort.postMessage({ type: 'status', status: 'loading' })
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
  console.log('[qwen-child] Model ready')
  process.parentPort.postMessage({ type: 'status', status: 'ready' })
  return generator
}

// utilityProcess receives messages via process.parentPort, not process.on('message')
process.parentPort.on('message', async (e: Electron.MessageEvent) => {
  const { id, messages, options } = e.data as { id: number; messages: unknown[]; options: unknown }
  console.log(`[qwen-child] received inference request id=${id}`)
  try {
    const gen = await loadGenerator()
    console.log(`[qwen-child] running inference id=${id}`)
    const output = await gen(messages, options)
    console.log(`[qwen-child] inference done id=${id}`)
    process.parentPort.postMessage({ id, output })
  } catch (err) {
    console.error(`[qwen-child] inference error id=${id}:`, err)
    process.parentPort.postMessage({ id, error: String(err) })
  }
})
