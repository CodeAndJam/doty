import { workerData, parentPort } from 'worker_threads'
import { join } from 'path'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sherpa = require('sherpa-onnx-node')

const MODEL_DIR: string = workerData.modelDir

const recognizer = new sherpa.OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: {
      encoder: join(MODEL_DIR, 'encoder.int8.onnx'),
      decoder: join(MODEL_DIR, 'decoder.int8.onnx'),
      joiner: join(MODEL_DIR, 'joiner.int8.onnx'),
    },
    tokens: join(MODEL_DIR, 'tokens.txt'),
    numThreads: 2,
    debug: 0,
  },
  decodingMethod: 'greedy_search',
})

parentPort!.on('message', ({ id, buffer, sampleRate }: { id: number; buffer: ArrayBuffer; sampleRate: number }) => {
  try {
    const samples = new Float32Array(buffer)
    const stream = recognizer.createStream()
    stream.acceptWaveform({ samples, sampleRate })
    recognizer.decode(stream)
    const result = recognizer.getResult(stream)
    parentPort!.postMessage({ id, text: (result.text as string).trim() })
  } catch (e) {
    parentPort!.postMessage({ id, error: String(e) })
  }
})
