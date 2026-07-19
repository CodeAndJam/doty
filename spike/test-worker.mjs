/**
 * Spike test: run transcribe-cpp streaming in a Worker thread.
 * Usage: node spike/test-worker.mjs
 */
import { Worker } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const modelPath = resolve(process.env.HOME, '.doty/models/parakeet-unified-en-0.6b-Q8_0.gguf')

// Read WAV PCM
const wavBuf = readFileSync('/tmp/test_speech.wav')
const numSamples = (wavBuf.byteLength - 44) / 2
const allSamples = new Float32Array(numSamples)
for (let i = 0; i < numSamples; i++) {
  allSamples[i] = wavBuf.readInt16LE(44 + i * 2) / 32768
}
console.log(`Audio: ${(allSamples.length / 16000).toFixed(2)}s, ${numSamples} samples`)

const worker = new Worker(resolve(__dirname, 'transcribe-worker.mjs'), {
  workerData: { modelPath },
})

const CHUNK_SIZE = 8000 // 500ms at 16kHz
let chunkIndex = 0

worker.on('message', async (msg) => {
  switch (msg.type) {
    case 'backends':
      console.log('Backends (from worker):', msg.backends.map((b) => `${b.kind}:${b.name}`).join(', '))
      break
    case 'loaded':
      console.log(`Model loaded in worker: ${msg.elapsed}ms`)
      worker.postMessage({ type: 'stream-start' })
      break
    case 'stream-ready':
      console.log('Stream ready, feeding chunks...')
      feedNextChunk()
      break
    case 'text':
      if (msg.committed) {
        console.log(`  [chunk ${chunkIndex}] C: "${msg.committed}"`)
      }
      feedNextChunk()
      break
    case 'final':
      console.log('---')
      console.log('FINAL:', msg.committed)
      console.log('---')
      console.log('SPIKE PASS: transcribe-cpp streaming works in Worker thread with Metal.')
      worker.postMessage({ type: 'dispose' })
      break
    case 'disposed':
      // Give Metal a moment to clean up before exiting
      setTimeout(() => process.exit(0), 100)
      break
    case 'error':
      console.error('Worker error:', msg.error)
      process.exit(1)
      break
  }
})

worker.on('error', (e) => {
  console.error('Worker thread error:', e)
  process.exit(1)
})

function feedNextChunk() {
  const offset = chunkIndex * CHUNK_SIZE
  if (offset >= allSamples.length) {
    worker.postMessage({ type: 'finalize' })
    return
  }
  const chunk = allSamples.slice(offset, Math.min(offset + CHUNK_SIZE, allSamples.length))
  const buf = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
  worker.postMessage({ type: 'feed', buffer: buf }, [buf])
  chunkIndex++
}
