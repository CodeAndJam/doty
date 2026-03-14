/**
 * PCM audio mixer — combines a base music stream with overlaid SFX streams.
 * All inputs and output are raw s16le stereo 48kHz PCM.
 *
 * Each source stream pushes data into a ring buffer via 'readable' events.
 * A fixed-interval loop reads from all buffers, mixes the samples, and
 * pushes the result into the Readable output that the AudioPlayer consumes.
 */
import { Readable } from 'stream'

/** 48kHz stereo s16le = 192000 bytes/sec. 20ms frame = 3840 bytes */
const FRAME_BYTES = 3840
const BYTES_PER_SAMPLE = 2
const NUM_SAMPLES_PER_FRAME = FRAME_BYTES / BYTES_PER_SAMPLE

interface MixerSource {
  id: string
  stream: Readable
  buffer: Buffer
  volume: number
  ended: boolean
}

function drainIntoBuffer(src: MixerSource): void {
  // Pull all available data from the stream into our buffer
  let chunk: Buffer | null
  while ((chunk = src.stream.read() as Buffer | null) !== null) {
    src.buffer = Buffer.concat([src.buffer, chunk])
  }
}

function consumeFrame(src: MixerSource): Buffer | null {
  drainIntoBuffer(src)
  if (src.buffer.length < FRAME_BYTES) return null
  const frame = src.buffer.subarray(0, FRAME_BYTES)
  src.buffer = src.buffer.subarray(FRAME_BYTES)
  return frame
}

export class PcmMixer extends Readable {
  private musicSource: MixerSource | null = null
  private sfxSources: MixerSource[] = []
  private mixInterval: ReturnType<typeof setInterval> | null = null
  private _destroyed = false

  constructor() {
    super({ highWaterMark: FRAME_BYTES * 10 })
  }

  /** Set (or replace) the base music stream */
  setMusic(stream: Readable | null): void {
    if (this.musicSource) {
      this.musicSource.stream.removeAllListeners()
      this.musicSource.stream.destroy()
    }

    if (!stream) {
      this.musicSource = null
      return
    }

    const src: MixerSource = {
      id: 'music',
      stream,
      buffer: Buffer.alloc(0),
      volume: 1.0,
      ended: false,
    }

    stream.on('end', () => {
      console.log('[mixer] Music stream ended')
      src.ended = true
    })
    stream.on('error', (err) => {
      console.error('[mixer] Music stream error:', err.message)
      src.ended = true
    })

    this.musicSource = src
    this.ensureMixing()
  }

  /** Add an SFX overlay stream with optional volume (0..1) */
  addSfx(id: string, stream: Readable, volume = 1.0): void {
    const src: MixerSource = {
      id,
      stream,
      buffer: Buffer.alloc(0),
      volume,
      ended: false,
    }

    stream.on('end', () => {
      console.log(`[mixer] SFX ${id} stream ended`)
      src.ended = true
    })
    stream.on('error', (err) => {
      console.error(`[mixer] SFX ${id} error:`, err.message)
      src.ended = true
    })

    this.sfxSources.push(src)
    console.log(`[mixer] Added SFX ${id} (vol=${volume.toFixed(2)}), active SFX: ${this.sfxSources.length}`)
    this.ensureMixing()
  }

  /** Remove all SFX (e.g. on stopAll) */
  clearSfx(): void {
    for (const src of this.sfxSources) {
      src.stream.removeAllListeners()
      src.stream.destroy()
    }
    this.sfxSources = []
  }

  private ensureMixing(): void {
    if (this.mixInterval || this._destroyed) return
    console.log('[mixer] Starting mix loop')
    this.mixInterval = setInterval(() => this.mixFrame(), 20)
  }

  private stopMixing(): void {
    if (this.mixInterval) {
      console.log('[mixer] Stopping mix loop')
      clearInterval(this.mixInterval)
      this.mixInterval = null
    }
  }

  private mixFrame(): void {
    if (this._destroyed) {
      this.stopMixing()
      return
    }

    // Read music frame
    let musicFrame: Buffer | null = null
    if (this.musicSource && !this.musicSource.ended) {
      musicFrame = consumeFrame(this.musicSource)
    }
    // Clean up ended music source if buffer is also drained
    if (this.musicSource?.ended && this.musicSource.buffer.length < FRAME_BYTES) {
      this.musicSource.stream.removeAllListeners()
      this.musicSource.stream.destroy()
      this.musicSource = null
    }

    // Clean up finished SFX (ended + buffer drained)
    this.sfxSources = this.sfxSources.filter(s => {
      if (s.ended && s.buffer.length < FRAME_BYTES) {
        s.stream.removeAllListeners()
        s.stream.destroy()
        return false
      }
      return true
    })

    // Read SFX frames
    const sfxFrames: { buf: Buffer; volume: number }[] = []
    for (const src of this.sfxSources) {
      const frame = consumeFrame(src)
      if (frame) {
        sfxFrames.push({ buf: frame, volume: src.volume })
      }
    }

    // Build output frame — always push to keep the player alive
    const output = Buffer.alloc(FRAME_BYTES, 0)

    // Copy music into output
    if (musicFrame) {
      musicFrame.copy(output, 0, 0, Math.min(musicFrame.length, FRAME_BYTES))
    }

    // Mix in SFX samples
    for (const { buf, volume } of sfxFrames) {
      const len = Math.min(buf.length / BYTES_PER_SAMPLE, NUM_SAMPLES_PER_FRAME)
      for (let i = 0; i < len; i++) {
        const offset = i * BYTES_PER_SAMPLE
        const baseSample = output.readInt16LE(offset)
        const sfxSample = Math.round(buf.readInt16LE(offset) * volume)
        const mixed = Math.max(-32768, Math.min(32767, baseSample + sfxSample))
        output.writeInt16LE(mixed, offset)
      }
    }

    this.push(output)
  }

  _read(_size: number): void {
    this.ensureMixing()
  }

  _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this._destroyed = true
    this.stopMixing()
    if (this.musicSource) {
      this.musicSource.stream.removeAllListeners()
      this.musicSource.stream.destroy()
      this.musicSource = null
    }
    for (const src of this.sfxSources) {
      src.stream.removeAllListeners()
      src.stream.destroy()
    }
    this.sfxSources = []
    callback(error)
  }
}
