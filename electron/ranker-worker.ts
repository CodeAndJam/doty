/**
 * ranker-worker.ts — worker_threads worker for the decision-model ranker.
 * Keeps the 1.5 GB graph and its forward pass off the Electron main process.
 */
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { D1Omni, RANK_INSTRUCTIONS } from './d1-omni'

const { homePath } = workerData as { homePath: string }

let model: D1Omni | null = null
let loading: Promise<void> | null = null

function load(): Promise<void> {
  if (model) return Promise.resolve()
  loading ??= D1Omni.load(join(homePath, '.doty', 'models')).then((m) => {
    model = m
  })
  return loading
}

load().then(
  () => parentPort!.postMessage({ type: 'ready' }),
  (e) => parentPort!.postMessage({ type: 'fatal', error: e instanceof Error ? e.message : String(e) }),
)

parentPort!.on('message', async (msg: { type: string; id?: number; prompt?: string; candidates?: string[] }) => {
  if (msg.type !== 'decide' || msg.id === undefined) return
  try {
    await load()
    const probabilities = await model!.rank(msg.prompt ?? '', RANK_INSTRUCTIONS, msg.candidates ?? [])
    parentPort!.postMessage({ type: 'probabilities', id: msg.id, probabilities })
  } catch (e) {
    parentPort!.postMessage({ type: 'decide-error', id: msg.id, error: e instanceof Error ? e.message : String(e) })
  }
})
