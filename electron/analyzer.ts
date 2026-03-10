import { join } from 'path'
import { spawn } from 'child_process'
import fs from 'fs'

// eslint-disable-next-line @typescript-eslint/no-require-imports
let ffmpegPath: string = require('ffmpeg-static')
// In packaged app, binary is in asar.unpacked
ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked')

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let essentiaInstance: any = null

async function getEssentia() {
  if (essentiaInstance) return essentiaInstance
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EssentiaWASM, Essentia } = require('essentia.js')
  const wasm = await EssentiaWASM()
  essentiaInstance = new Essentia(wasm)
  return essentiaInstance
}

/** Decode audio file to mono Float32Array at 44100 Hz using ffmpeg */
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
      const duration = samples.length / sampleRate
      resolve({ samples, duration })
    })
  })
}

export async function analyzeFile(filePath: string): Promise<TrackMetadata> {
  const mtime = fs.statSync(filePath).mtimeMs
  const essentia = await getEssentia()

  const { samples, duration } = await decodeAudio(filePath)

  // Convert to essentia vector
  const signal = essentia.arrayToVector(samples)

  // BPM + beat confidence via RhythmDescriptors
  let bpm = 0
  let bpmConfidence = 0
  try {
    const rhythm = essentia.RhythmDescriptors(signal)
    bpm = Math.round(rhythm.bpm)
    bpmConfidence = parseFloat((rhythm.confidence ?? 0).toFixed(2))
  } catch { /* leave at 0 */ }

  // Key + scale
  let key = 'Unknown'
  let scale = 'major'
  try {
    const keyResult = essentia.KeyExtractor(signal)
    key = keyResult.key
    scale = keyResult.scale
  } catch { /* leave at Unknown */ }

  // Danceability (0–3)
  let danceability = 0
  try {
    const dResult = essentia.Danceability(signal)
    danceability = parseFloat(dResult.danceability.toFixed(2))
  } catch { /* leave at 0 */ }

  // Energy (0–1) — RMS of the signal
  let energy = 0
  try {
    const eResult = essentia.Energy(signal)
    // Energy returns sum of squares; normalize to 0–1 by clamping
    energy = parseFloat(Math.min(1, Math.sqrt(eResult.energy / samples.length) * 10).toFixed(2))
  } catch { /* leave at 0 */ }

  return { bpm, bpmConfidence, key, scale, danceability, energy, duration: Math.round(duration), mtime }
}
