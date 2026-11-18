import fs from 'node:fs'
import { updateWavHeader } from './wav-header'

/**
 * One recordable WAV: placeholder header, append-at-offset writes, header
 * refreshed every 30 s so a crash still leaves a playable file, and appends
 * across record/stop takes of the same session.
 */
export class WavWriter {
  private fd: number | null = null
  private bytes = 0
  private interval: ReturnType<typeof setInterval> | null = null

  constructor(readonly path: string) {}

  get active(): boolean {
    return this.fd !== null
  }

  start(): void {
    this.stop()
    let existingBytes = 0
    try {
      const stat = fs.statSync(this.path)
      const fd = fs.openSync(this.path, 'r')
      const magic = Buffer.alloc(4)
      fs.readSync(fd, magic, 0, 4, 0)
      fs.closeSync(fd)
      if (stat.size >= 44 && magic.toString() === 'RIFF') existingBytes = stat.size - 44
    } catch {
      /* new file */
    }
    if (existingBytes === 0) {
      const header = Buffer.alloc(44)
      header.write('RIFF', 0)
      header.writeUInt32LE(0, 4) // placeholder file size
      header.write('WAVE', 8)
      header.write('fmt ', 12)
      header.writeUInt32LE(16, 16) // PCM format chunk size
      header.writeUInt16LE(1, 20) // PCM format
      header.writeUInt16LE(1, 22) // mono
      header.writeUInt32LE(16000, 24) // sample rate
      header.writeUInt32LE(32000, 28) // byte rate (16000 * 2)
      header.writeUInt16LE(2, 32) // block align
      header.writeUInt16LE(16, 34) // bits per sample
      header.write('data', 36)
      header.writeUInt32LE(0, 40) // placeholder data size
      fs.writeFileSync(this.path, header)
    }
    this.fd = fs.openSync(this.path, 'r+')
    this.bytes = existingBytes
    this.interval = setInterval(() => {
      if (this.fd !== null) updateWavHeader(this.fd, this.bytes)
    }, 30_000)
  }

  append(samples: Float32Array): void {
    if (this.fd === null) return
    const int16 = Buffer.alloc(samples.length * 2)
    for (let i = 0; i < samples.length; i++) {
      int16.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768))), i * 2)
    }
    // Write at an explicit offset: appendFileSync on an fd starts at position 0
    // and would overwrite the 44-byte header.
    fs.writeSync(this.fd, int16, 0, int16.length, 44 + this.bytes)
    this.bytes += int16.length
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (this.fd === null) return
    updateWavHeader(this.fd, this.bytes)
    fs.closeSync(this.fd)
    this.fd = null
    this.bytes = 0
  }
}
