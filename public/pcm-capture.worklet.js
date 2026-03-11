// AudioWorklet processor — runs in audio thread
// Accumulates samples and posts a 1-second Float32Array to the main thread.
// The ASR worker uses Silero VAD to detect speech boundaries, so we send
// smaller chunks more frequently for better segmentation accuracy.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.segmentSamples = 16000 * 1 // 1 second at 16kHz
    this.buffer = new Float32Array(this.segmentSamples)
    this.writePos = 0
  }

  process(inputs) {
    const input = inputs[0]?.[0]
    if (!input) return true

    for (let i = 0; i < input.length; i++) {
      this.buffer[this.writePos++] = input[i]
      if (this.writePos >= this.segmentSamples) {
        const copy = this.buffer.buffer.slice(0)
        this.port.postMessage({ type: 'segment', buffer: copy }, [copy])
        this.buffer = new Float32Array(this.segmentSamples)
        this.writePos = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-capture', PcmCapture)
