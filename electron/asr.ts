import { join } from 'path'
import { MODEL_DIR } from './model-paths'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sherpa = require('sherpa-onnx-node')

let recognizer: ReturnType<typeof createRecognizer> | null = null

function createRecognizer() {
  return new sherpa.OfflineRecognizer({
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
}

export function initRecognizer(): void {
  if (!recognizer) {
    recognizer = createRecognizer()
  }
}

export function transcribeFloat32(samples: Float32Array, sampleRate = 16000): string {
  if (!recognizer) initRecognizer()
  const stream = recognizer!.createStream()
  stream.acceptWaveform({ samples, sampleRate })
  recognizer!.decode(stream)
  const result = recognizer!.getResult(stream)
  return (result.text as string).trim()
}

export function freeRecognizer(): void {
  if (recognizer) {
    recognizer.free?.()
    recognizer = null
  }
}
