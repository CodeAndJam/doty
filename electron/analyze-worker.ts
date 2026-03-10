/**
 * analyze-worker.ts
 * Runs in a worker_threads context — receives a file path via workerData,
 * analyzes it with essentia.js + ffmpeg, posts the result back.
 */
import { workerData, parentPort } from 'worker_threads'
import { spawn } from 'child_process'
import fs from 'fs'

// eslint-disable-next-line @typescript-eslint/no-require-imports
let ffmpegPath: string = require('ffmpeg-static')
ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let essentiaInstance: any = null

function getEssentia() {
  if (essentiaInstance) return essentiaInstance
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EssentiaWASM, Essentia } = require('essentia.js')
  essentiaInstance = new Essentia(EssentiaWASM)
  return essentiaInstance
}

function decodeAudio(filePath: string): Promise<{ samples: Float32Array; duration: number }> {
  return new Promise((resolve, reject) => {
    const sampleRate = 44100
    const chunks: Buffer[] = []

    const ff = spawn(ffmpegPath, [
      '-i', filePath,
      '-f', 'f32le',
      '-ar', String(sampleRate),
      '-ac', '1',
      '-vn',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] })

    ff.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    ff.on('error', reject)
    ff.on('close', (code) => {
      if (code !== 0 && chunks.length === 0) {
        return reject(new Error(`ffmpeg exited with code ${code}`))
      }
      const buf = Buffer.concat(chunks)
      const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
      resolve({ samples, duration: samples.length / sampleRate })
    })
  })
}

async function run() {
  const filePath: string = workerData.filePath
  const mtime = fs.statSync(filePath).mtimeMs
  const essentia = getEssentia()
  const { samples, duration } = await decodeAudio(filePath)
  const signal = essentia.arrayToVector(samples)

  let bpm = 0, bpmConfidence = 0
  try {
    const r = essentia.RhythmDescriptors(signal)
    bpm = Math.round(r.bpm)
    bpmConfidence = parseFloat((r.confidence ?? 0).toFixed(2))
  } catch { /* leave 0 */ }

  let key = 'Unknown', scale = 'major'
  try {
    const k = essentia.KeyExtractor(signal)
    key = k.key
    scale = k.scale
  } catch { /* leave Unknown */ }

  let danceability = 0
  try {
    danceability = parseFloat(essentia.Danceability(signal).danceability.toFixed(2))
  } catch { /* leave 0 */ }

  let energy = 0
  try {
    const e = essentia.Energy(signal).energy
    energy = parseFloat(Math.min(1, Math.sqrt(e / samples.length) * 10).toFixed(2))
  } catch { /* leave 0 */ }

  parentPort!.postMessage({ bpm, bpmConfidence, key, scale, danceability, energy, duration: Math.round(duration), mtime })
}

run().catch((err) => {
  parentPort!.postMessage({ error: String(err) })
})
