import { workerData, parentPort } from 'worker_threads'
import { join } from 'path'
import fs from 'fs'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sherpa = require('sherpa-onnx-node')

const MODEL_DIR: string = workerData.modelDir
const VAD_MODEL_PATH: string = workerData.vadModelPath
const HOTWORDS_FILE: string | null = workerData.hotwordsFile || null

// Determine decoding strategy: use beam search when hotwords are available
const hasHotwords = HOTWORDS_FILE && fs.existsSync(HOTWORDS_FILE)
  && fs.readFileSync(HOTWORDS_FILE, 'utf-8').trim().length > 0

const recognizer = new sherpa.OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: {
      encoder: join(MODEL_DIR, 'encoder.int8.onnx'),
      decoder: join(MODEL_DIR, 'decoder.int8.onnx'),
      joiner: join(MODEL_DIR, 'joiner.int8.onnx'),
    },
    tokens: join(MODEL_DIR, 'tokens.txt'),
    numThreads: 4,
    debug: 0,
    modelType: 'nemo_transducer',
  },
  decodingMethod: hasHotwords ? 'modified_beam_search' : 'greedy_search',
  maxActivePaths: hasHotwords ? 4 : 1,
  hotwordsFile: hasHotwords ? HOTWORDS_FILE : '',
  hotwordsScore: hasHotwords ? 2.0 : 0,
  blankPenalty: 0.5,
})

// Initialize Silero VAD if the model is available
let vad: InstanceType<typeof sherpa.Vad> | null = null
if (fs.existsSync(VAD_MODEL_PATH)) {
  try {
    vad = new sherpa.Vad({
      sileroVad: {
        model: VAD_MODEL_PATH,
        threshold: 0.4,
        minSilenceDuration: 0.3,
        minSpeechDuration: 0.25,
        windowSize: 512,
        maxSpeechDuration: 15,
      },
      sampleRate: 16000,
      numThreads: 1,
      debug: 0,
    }, 30)
    console.log('[asr-worker] Silero VAD initialized')
  } catch (e) {
    console.error('[asr-worker] VAD init failed, falling back to raw chunks:', e)
    vad = null
  }
}

function transcribeSegment(samples: Float32Array, sampleRate: number): string {
  const stream = recognizer.createStream()
  stream.acceptWaveform({ samples, sampleRate })
  recognizer.decode(stream)
  const result = recognizer.getResult(stream)
  return (result.text as string).trim()
}

parentPort!.on('message', ({ id, buffer, sampleRate }: { id: number; buffer: ArrayBuffer; sampleRate: number }) => {
  try {
    const samples = new Float32Array(buffer)

    if (vad) {
      // Feed audio through VAD, transcribe each detected speech segment
      vad.acceptWaveform(samples)
      const texts: string[] = []

      while (!vad.isEmpty()) {
        const segment = vad.front()
        vad.pop()
        const text = transcribeSegment(segment.samples, sampleRate)
        if (text) texts.push(text)
      }

      parentPort!.postMessage({ id, text: texts.join(' ') })
    } else {
      // Fallback: transcribe the raw chunk directly
      const text = transcribeSegment(samples, sampleRate)
      parentPort!.postMessage({ id, text })
    }
  } catch (e) {
    parentPort!.postMessage({ id, error: String(e) })
  }
})
