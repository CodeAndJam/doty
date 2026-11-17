import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { ANALYSIS_VERSION } from './analysis-version'

export { ANALYSIS_VERSION }

import { Worker } from 'node:worker_threads'

/**
 * Bump when the analysis itself changes meaning — not when it is merely re-run.
 * Cached rows carry the version that produced them, so a formula fix (the energy
 * clamp was one) re-analyses the library instead of trusting stale numbers.
 */

export interface TrackMetadata {
  bpm: number
  bpmConfidence: number
  key: string
  scale: string
  danceability: number
  /** 0..1, derived from RMS loudness: 0 is near silence, 1 is full scale. */
  energy: number
  /** RMS loudness in dBFS, the raw number `energy` is derived from. */
  loudness: number
  /** Which analysis produced this row. */
  analysisVersion: number
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
/**
 * The worker sits beside the main entry, but this module can be emitted into a
 * `chunks/` directory when the bundler shares it. Walk up until it is found
 * rather than assuming, or every track fails analysis with MODULE_NOT_FOUND.
 */
function workerPath(): string {
  let dir = __dirname
  for (let depth = 0; depth < 3; depth++) {
    const candidate = join(dir, 'analyze-worker.js')
    if (fs.existsSync(candidate)) return candidate
    dir = dirname(dir)
  }
  return join(__dirname, 'analyze-worker.js')
}

const WORKER_PATH = workerPath()

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
