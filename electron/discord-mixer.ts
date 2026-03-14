/**
 * PCM audio mixer — combines a base music stream with overlaid SFX streams.
 * All inputs and output are raw s16le stereo 48kHz PCM.
 *
 * The mixer reads fixed-size frames from the music source and any active SFX
 * sources, sums the samples with clamping, and pushes the mixed result.
 * When no music is playing, silence is used as the base layer so SFX still work.
 */
import { Readable, PassThrough } from 'stream'

/** 48kHz stereo s16le = 192000 bytes/sec. 20ms frame = 3840 bytes */
const FRAME_BYTES = 3840
const SAMPLE_RATE = 48000
const CHANNELS = 2
const BYTES_PER_SAMPLE = 2

interface SfxSource {
  id: string
  stream: Readable
  volume: number
  done: boolean
}

export class PcmMixer extends Readable {
  private musicSource: Readable | null = null
  private musicDone = false
  private sfxSources: SfxSource[] = []
  private mixInterval: ReturnType<typeof setInterval> | null = null
  private _destroyed = false

  constructor() {
    super({ highWaterMark: FRAME_BYTES * 4 })
  }

  /** Set (or replace) the base music stream */
  setMusic(stream: Readable | null): void {
    if (this.musicSource) {
      this.musicSource.destroy()
    }
    this.musicSource = stream
    this.musicDone = !stream

    if (stream) {
      stream.on('end', () => { this.musicDone = true })
      stream.on('error', () => { this.musicDone = true })
    }

    this.ensureMixing()
  }

  /** Add an SFX overlay stream with optional volume (0..1) */
  addSfx(id: string, stream: Readable, volume = 1.0): void {
    const src: SfxSource = { id, stream, volume, done: false }
    stream.on('end', () => { src.done = true })
    stream.on('error', () => { src.done = true })
    this.sfxSources.push(src)
    this.ensureMixing()
  }

  /** Remove all SFX (e.g. on stopAll) */
  clearSfx(): void {
    for (const src of this.sfxSources) {
      src.stream.destroy()
    }
    this.sfxSources = []
  }

  /** Check if the mixer has any active sources */
  get hasActiveSources(): boolean {
    return (this.musicSource !== null && !this.musicDone) ||
           this.sfxSources.some(s => !s.done)
  }

  private ensureMixing(): void {
    if (this.mixInterval || this._destroyed) return
    // Mix at ~20ms intervals (50 fps) to keep latency low
    this.mixInterval = setInterval(() => this.mixFrame(), 20)
  }

  private stopMixing(): void {
    if (this.mixInterval) {
      clearInterval(this.mixInterval)
      this.mixInterval = null
    }
  }

  private mixFrame(): void {
    if (this._destroyed) {
      this.stopMixing()
      return
    }

    // Read music frame (or silence)
    const musicBuf = this.musicSource && !this.musicDone
      ? this.musicSource.read(FRAME_BYTES) as Buffer | null
      : null

    // Clean up finished SFX
    this.sfxSources = this.sfxSources.filter(s => {
      if (s.done) { s.stream.destroy(); return false }
      return true
    })

    // Read SFX frames
    const sfxBufs: { buf: Buffer; volume: number }[] = []
    for (const src of this.sfxSources) {
      const buf = src.stream.read(FRAME_BYTES) as Buffer | null
      if (buf && buf.length > 0) {
        sfxBufs.push({ buf, volume: src.volume })
      }
    }

    // If nothing to mix and music is done, push silence to keep stream alive
    // (the player needs continuous data or it goes Idle)
    if (!musicBuf && sfxBufs.length === 0) {
      if (!this.hasActiveSources) {
        // Everything is done — push silence briefly then stop
        this.stopMixing()
      }
      // Push a silent frame to keep the stream alive
      const silence = Buffer.alloc(FRAME_BYTES, 0)
      this.push(silence)
      return
    }

    // Start with music or silence as base
    const output = Buffer.alloc(FRAME_BYTES, 0)
    const numSamples = FRAME_BYTES / BYTES_PER_SAMPLE

    if (musicBuf) {
      musicBuf.copy(output, 0, 0, Math.min(musicBuf.length, FRAME_BYTES))
    }

    // Mix in SFX samples
    for (const { buf, volume } of sfxBufs) {
      const len = Math.min(buf.length / BYTES_PER_SAMPLE, numSamples)
      for (let i = 0; i < len; i++) {
        const offset = i * BYTES_PER_SAMPLE
        const baseSample = output.readInt16LE(offset)
        const sfxSample = Math.round(buf.readInt16LE(offset) * volume)
        // Sum with clamping to prevent clipping
        const mixed = Math.max(-32768, Math.min(32767, baseSample + sfxSample))
        output.writeInt16LE(mixed, offset)
      }
    }

    this.push(output)
  }

  _read(_size: number): void {
    // Data is pushed by the mix interval, not pulled
    this.ensureMixing()
  }

  _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this._destroyed = true
    this.stopMixing()
    this.musicSource?.destroy()
    for (const src of this.sfxSources) {
      src.stream.destroy()
    }
    this.sfxSources = []
    callback(error)
  }
}
