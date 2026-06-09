/**
 * reprocess-worker.ts — Offline reprocessing of session WAV files.
 *
 * Reads a WAV file, runs VAD to find speech segments, transcribes each segment
 * with the chosen model, and emits VTT cues with accurate timestamps.
 *
 * Messages IN:  { wavPath, modelDir, sttModel, vadModelPath, hotwordsFile, denoiserModelPath }
 * Messages OUT: { type: 'progress', percent }
 *             | { type: 'cue', start, end, text }
 *             | { type: 'done' }
 *             | { type: 'error', message }
 */
import fs from 'node:fs'
import { join } from 'node:path'
import { parentPort } from 'node:worker_threads'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sherpa = require('sherpa-onnx-node')

const SAMPLE_RATE = 16000

function readWavSamples(wavPath: string): Float32Array {
  const buf = fs.readFileSync(wavPath)
  let offset = 12
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4)
    const sz = buf.readUInt32LE(offset + 4)
    if (id === 'data') {
      const start = offset + 8
      const numSamples = sz / 2 // 16-bit
      const samples = new Float32Array(numSamples)
      for (let i = 0; i < numSamples; i++) {
        samples[i] = buf.readInt16LE(start + i * 2) / 32768.0
      }
      return samples
    }
    offset += 8 + sz
    if (sz % 2 !== 0) offset++
  }
  throw new Error('No data chunk in WAV')
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0')
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0')
  const s = String(totalSec % 60).padStart(2, '0')
  const millis = String(ms % 1000).padStart(3, '0')
  return `${h}:${m}:${s}.${millis}`
}

parentPort!.on('message', (msg) => {
  const { wavPath, modelDir, sttModel, vadModelPath, hotwordsFile, denoiserModelPath } = msg

  try {
    const samples = readWavSamples(wavPath)
    const totalSamples = samples.length
    parentPort!.postMessage({ type: 'progress', percent: 5 })

    // Init recognizer
    let recognizer: any
    if (sttModel?.startsWith('whisper')) {
      const prefix = sttModel === 'whisper-medium' ? 'medium' : 'large-v3'
      const featureDim = sttModel === 'whisper-large-v3' ? 128 : 80
      recognizer = new sherpa.OfflineRecognizer({
        featConfig: { sampleRate: SAMPLE_RATE, featureDim },
        modelConfig: {
          whisper: {
            encoder: join(modelDir, `${prefix}-encoder.int8.onnx`),
            decoder: join(modelDir, `${prefix}-decoder.int8.onnx`),
            language: '',
            task: 'transcribe',
            tailPaddings: -1,
          },
          tokens: join(modelDir, `${prefix}-tokens.txt`),
          numThreads: 4,
          debug: 0,
        },
        decodingMethod: 'greedy_search',
      })
    } else {
      // Parakeet TDT
      const hasHotwords =
        hotwordsFile && fs.existsSync(hotwordsFile) && fs.readFileSync(hotwordsFile, 'utf-8').trim().length > 0
      recognizer = new sherpa.OfflineRecognizer({
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
          transducer: {
            encoder: join(modelDir, 'encoder.int8.onnx'),
            decoder: join(modelDir, 'decoder.int8.onnx'),
            joiner: join(modelDir, 'joiner.int8.onnx'),
          },
          tokens: join(modelDir, 'tokens.txt'),
          numThreads: 4,
          debug: 0,
          modelType: 'nemo_transducer',
        },
        decodingMethod: hasHotwords ? 'modified_beam_search' : 'greedy_search',
        maxActivePaths: hasHotwords ? 4 : 1,
        hotwordsFile: hasHotwords ? hotwordsFile : '',
        hotwordsScore: hasHotwords ? 2.0 : 0,
        blankPenalty: 0.5,
      })
    }

    // Init VAD
    let vad: any = null
    if (vadModelPath && fs.existsSync(vadModelPath)) {
      vad = new sherpa.Vad(
        {
          sileroVad: {
            model: vadModelPath,
            threshold: 0.3,
            minSilenceDuration: 0.5,
            minSpeechDuration: 0.25,
            windowSize: 512,
            maxSpeechDuration: 30, // longer segments for offline accuracy
          },
          sampleRate: SAMPLE_RATE,
          numThreads: 1,
          debug: 0,
        },
        60,
      )
    }

    // Init denoiser
    let denoiser: any = null
    if (denoiserModelPath && fs.existsSync(denoiserModelPath)) {
      try {
        denoiser = new sherpa.OfflineSpeechDenoiser({
          model: { gtcrn: { model: denoiserModelPath }, numThreads: 1, debug: 0 },
          sampleRate: SAMPLE_RATE,
        })
      } catch {}
    }

    parentPort!.postMessage({ type: 'progress', percent: 10 })

    // Feed all audio through VAD
    if (vad) {
      const CHUNK = SAMPLE_RATE // 1s chunks for progress reporting
      let fed = 0
      while (fed < totalSamples) {
        const end = Math.min(fed + CHUNK, totalSamples)
        vad.acceptWaveform(samples.subarray(fed, end))
        fed = end
        const percent = 10 + Math.round((fed / totalSamples) * 40) // 10-50%
        parentPort!.postMessage({ type: 'progress', percent })
      }
      vad.flush()

      // Collect segments and transcribe
      const segments: Array<{ start: number; end: number; samples: Float32Array }> = []
      while (!vad.isEmpty()) {
        const seg = vad.front(false)
        vad.pop()
        if (seg.samples.length / SAMPLE_RATE < 0.25) continue
        segments.push({
          start: seg.start ?? 0,
          end: (seg.start ?? 0) + seg.samples.length / SAMPLE_RATE,
          samples: seg.samples,
        })
      }

      let samplesProcessed = 0
      const totalSegSamples = segments.reduce((a, s) => a + s.samples.length, 0)

      for (const seg of segments) {
        let audio = seg.samples
        if (denoiser) {
          try {
            const r = denoiser.run({ samples: audio, sampleRate: SAMPLE_RATE, enableExternalBuffer: false })
            if (r.samples) audio = r.samples
          } catch {}
        }

        const stream = recognizer.createStream()
        stream.acceptWaveform({ samples: audio, sampleRate: SAMPLE_RATE })
        recognizer.decode(stream)
        const text = (recognizer.getResult(stream).text as string).trim()

        if (text) {
          const startMs = Math.round(seg.start * 1000)
          const endMs = Math.round(seg.end * 1000)
          parentPort!.postMessage({
            type: 'cue',
            start: formatTimestamp(startMs),
            end: formatTimestamp(endMs),
            text,
          })
        }

        samplesProcessed += seg.samples.length
        const percent = 50 + Math.round((samplesProcessed / totalSegSamples) * 48) // 50-98%
        parentPort!.postMessage({ type: 'progress', percent })
      }
    } else {
      // Fallback: no VAD, transcribe in 30s chunks
      const CHUNK_S = 30
      const chunkSamples = CHUNK_S * SAMPLE_RATE
      for (let i = 0; i < totalSamples; i += chunkSamples) {
        const chunk = samples.subarray(i, Math.min(i + chunkSamples, totalSamples))
        const stream = recognizer.createStream()
        stream.acceptWaveform({ samples: chunk, sampleRate: SAMPLE_RATE })
        recognizer.decode(stream)
        const text = (recognizer.getResult(stream).text as string).trim()
        if (text) {
          const startMs = Math.round((i / SAMPLE_RATE) * 1000)
          const endMs = Math.round((Math.min(i + chunkSamples, totalSamples) / SAMPLE_RATE) * 1000)
          parentPort!.postMessage({ type: 'cue', start: formatTimestamp(startMs), end: formatTimestamp(endMs), text })
        }
        const percent = 10 + Math.round((i / totalSamples) * 88)
        parentPort!.postMessage({ type: 'progress', percent })
      }
    }

    parentPort!.postMessage({ type: 'progress', percent: 100 })
    parentPort!.postMessage({ type: 'done' })
  } catch (e) {
    parentPort!.postMessage({ type: 'error', message: String(e) })
  }
})
