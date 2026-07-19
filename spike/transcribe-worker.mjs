/**
 * Spike: transcribe-cpp in a Node.js Worker thread (simulates Electron main→worker pattern).
 * Tests that the FFI binding works off the main thread.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { TranscribeModel, getAvailableBackends } from 'transcribe-cpp'

const { modelPath } = workerData

async function init() {
  const backends = getAvailableBackends()
  parentPort.postMessage({ type: 'backends', backends })

  const t0 = Date.now()
  const model = await TranscribeModel.load(modelPath, { backend: 'auto' })
  parentPort.postMessage({ type: 'loaded', elapsed: Date.now() - t0 })

  const session = model.createSession()

  parentPort.on('message', async (msg) => {
    if (msg.type === 'stream-start') {
      const stream = await session.stream({ commitPolicy: 'stable_prefix' })
      parentPort.postMessage({ type: 'stream-ready' })

      // Store stream reference for feed/finalize
      parentPort._stream = stream
    } else if (msg.type === 'feed') {
      const stream = parentPort._stream
      const samples = new Float32Array(msg.buffer)
      await stream.feed(samples)
      const { committed, tentative } = stream.text
      parentPort.postMessage({ type: 'text', committed, tentative })
    } else if (msg.type === 'finalize') {
      const stream = parentPort._stream
      await stream.finalize()
      const { committed } = stream.text
      parentPort.postMessage({ type: 'final', committed })
      stream.reset()
      parentPort._stream = null
    } else if (msg.type === 'dispose') {
      session.dispose()
      model.dispose()
      parentPort.postMessage({ type: 'disposed' })
      // Don't call process.exit() — let the worker thread terminate naturally
      // to avoid Metal cleanup assertion on macOS
    }
  })
}

init().catch((e) => {
  parentPort.postMessage({ type: 'error', error: e.message })
  process.exit(1)
})
