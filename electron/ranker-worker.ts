/**
 * ranker-worker.ts — worker_threads worker for the decision-model ranker.
 * Keeps the 1.5 GB graph and its forward pass off the Electron main process.
 */
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { D1Omni, RANK_INSTRUCTIONS, SFX_INSTRUCTIONS } from './d1-omni'

const { homePath } = workerData as { homePath: string }

let model: D1Omni | null = null
let loading: Promise<void> | null = null
let closing = false
let shuttingDown = false
let inFlight = 0
let loadSettled = false

function load(): Promise<void> {
  if (model) return Promise.resolve()
  loading ??= D1Omni.load(join(homePath, '.doty', 'models')).then((m) => {
    model = m
  })
  return loading
}

/**
 * Leave only when no forward pass is running. Terminating the thread mid-Run
 * aborts the process inside onnxruntime (Napi::Error), which no later cleanup
 * can repair.
 */
async function maybeShutdown(): Promise<void> {
  if (!closing || inFlight > 0 || !loadSettled || shuttingDown) return
  shuttingDown = true
  try {
    await model?.dispose()
  } catch {
    /* already gone */
  }
  parentPort!.postMessage({ type: 'closed' })
  parentPort!.close()
}

load().then(
  () => {
    loadSettled = true
    parentPort!.postMessage({ type: 'ready' })
    void maybeShutdown()
  },
  (e) => {
    loadSettled = true
    parentPort!.postMessage({ type: 'fatal', error: e instanceof Error ? e.message : String(e) })
    void maybeShutdown()
  },
)

type Incoming = { type: string; id?: number; prompt?: string; candidates?: string[] }

parentPort!.on('message', async (msg: Incoming) => {
  if (msg.type === 'close') {
    closing = true
    void maybeShutdown()
    return
  }
  if (msg.id === undefined) return
  inFlight++
  try {
    await load()
    if (msg.type === 'decide') {
      const probabilities = await model!.rank(msg.prompt ?? '', RANK_INSTRUCTIONS, msg.candidates ?? [])
      parentPort!.postMessage({ type: 'probabilities', id: msg.id, probabilities })
      return
    }
    if (msg.type === 'sfx') {
      const probabilities = await model!.rank(msg.prompt ?? '', SFX_INSTRUCTIONS, msg.candidates ?? [])
      parentPort!.postMessage({ type: 'probabilities', id: msg.id, probabilities })
      return
    }
    if (msg.type === 'evaluate') {
      const { tracks, moods } = await model!.evaluate(msg.prompt ?? '', msg.candidates ?? [])
      parentPort!.postMessage({ type: 'evaluated', id: msg.id, tracks, moods })
    }
  } catch (e) {
    parentPort!.postMessage({ type: 'decide-error', id: msg.id, error: e instanceof Error ? e.message : String(e) })
  } finally {
    inFlight--
    void maybeShutdown()
  }
})
