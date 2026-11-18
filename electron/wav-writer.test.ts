import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WavWriter } from './wav-writer'

describe('WavWriter', () => {
  let file: string

  beforeEach(() => {
    file = path.join(os.tmpdir(), `doty-wav-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`)
  })

  afterEach(() => {
    try {
      fs.unlinkSync(file)
    } catch {}
  })

  it('writes a valid mono 16 kHz header and the samples it was given', () => {
    const writer = new WavWriter(file)
    writer.start()
    writer.append(Float32Array.of(0.5, -0.5))
    writer.stop()

    const buf = fs.readFileSync(file)
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF')
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE')
    expect(buf.readUInt16LE(22)).toBe(1) // mono
    expect(buf.readUInt32LE(24)).toBe(16000)
    expect(buf.readUInt32LE(40)).toBe(4) // two samples, 2 bytes each
    expect(buf.readUInt32LE(4)).toBe(36 + 4)
    expect(buf.readInt16LE(44)).toBe(16384)
    expect(buf.readInt16LE(46)).toBe(-16384)
  })

  it('appends to the same file across takes instead of overwriting', () => {
    const writer = new WavWriter(file)
    writer.start()
    writer.append(Float32Array.of(0.25))
    writer.stop()

    const again = new WavWriter(file)
    again.start()
    again.append(Float32Array.of(0.25))
    again.stop()

    const buf = fs.readFileSync(file)
    expect(buf.readUInt32LE(40)).toBe(4)
    expect(buf.readInt16LE(44)).toBe(8192)
    expect(buf.readInt16LE(46)).toBe(8192)
  })

  it('ignores appends after stop', () => {
    const writer = new WavWriter(file)
    writer.start()
    writer.stop()
    writer.append(Float32Array.of(0.5))
    expect(fs.statSync(file).size).toBe(44)
  })
})
