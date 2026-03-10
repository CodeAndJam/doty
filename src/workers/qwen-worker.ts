/**
 * qwen-worker.ts — Renderer Web Worker (IIFE format)
 * Uses @huggingface/transformers v4 with plain CPU WASM backend.
 * Explicitly points wasmPaths to the non-JSEP WASM to avoid CDN fetches
 * and the JSEP/WebGPU proxy worker that crashes on Apple M4.
 */
import { pipeline, env } from '@huggingface/transformers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wasmEnv = (env.backends as any).onnx.wasm
wasmEnv.proxy = false       // no proxy worker — avoids CDN fetch of jsep.mjs
wasmEnv.numThreads = 1      // single-threaded — COEP headers don't work in Electron file://
// Explicit path to the non-JSEP asyncify WASM copied to public/.
// Works in both dev (http://localhost:5173) and prod (app://doty/).
wasmEnv.wasmPaths = {
  wasm: new URL('/ort-wasm-simd-threaded.asyncify.wasm', self.location.origin).href,
}

// Cache compiled WASM module in IndexedDB — skips recompilation on subsequent launches
env.useWasmCache = true

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generatorPromise: Promise<any> | null = null

function getGenerator() {
  if (!generatorPromise) {
    self.postMessage({ type: 'status', status: 'loading' })
    generatorPromise = pipeline('text-generation', 'onnx-community/Qwen3-0.6B-ONNX', {
      dtype: 'q4',
      device: 'wasm',
    }).then((gen) => {
      self.postMessage({ type: 'status', status: 'ready' })
      return gen
    }).catch((err) => {
      console.error('[qwen-worker] load error:', err)
      generatorPromise = null
      throw err
    })
  }
  return generatorPromise
}

// Start loading immediately when the worker is created
getGenerator().catch(() => { /* error already logged above */ })

self.onmessage = async (e: MessageEvent) => {
  const { id, messages, options } = e.data
  try {
    const gen = await getGenerator()
    const output = await gen(messages, options)
    self.postMessage({ id, output })
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
}
