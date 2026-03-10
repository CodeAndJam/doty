import { join } from 'path'
import { Worker } from 'worker_threads'

export interface TrackMetadata {
  bpm: number
  bpmConfidence: number
  key: string
  scale: string
  danceability: number
  energy: number
  duration: number
  mtime: number
}

// In dev: worker is built to out/main/analyze-worker.js
// In prod: same location relative to __dirname
const WORKER_PATH = join(__dirname, 'analyze-worker.js')

export function analyzeFile(filePath: string): Promise<TrackMetadata> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData: { filePath } })
    worker.once('message', (msg) => {
      if (msg.error) reject(new Error(msg.error))
      else resolve(msg as TrackMetadata)
    })
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`analyze-worker exited with code ${code}`))
    })
  })
}
