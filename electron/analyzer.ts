import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

export interface TrackMetadata {
  bpm: number
  bpmConfidence: number
  key: string
  scale: string
  danceability: number
  energy: number
  duration: number
  mtime: number
  // ID3 / file tags
  title: string | null
  artist: string | null
  album: string | null
  genre: string | null
  year: number | null
  trackNo: number | null
  bitrate: number | null
  sampleRate: number | null
  channels: number | null
  codec: string | null
}

// In dev: worker is built to out/main/analyze-worker.js
// In prod: same location relative to __dirname
const WORKER_PATH = join(__dirname, 'analyze-worker.js')

export function analyzeFile(filePath: string): Promise<TrackMetadata> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData: { filePath } })
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }
    worker.once('message', (msg) => {
      finish(() => (msg.error ? reject(new Error(msg.error)) : resolve(msg as TrackMetadata)))
    })
    worker.once('error', (err) => finish(() => reject(err)))
    // Any exit before a message (including code 0) must settle, otherwise the scan hangs.
    worker.once('exit', (code) => finish(() => reject(new Error(`analyze-worker exited with code ${code}`))))
  })
}
