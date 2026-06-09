import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { updateWavHeader } from './wav-header'

describe('updateWavHeader', () => {
  let tmpFile: string
  let fd: number

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `wav-test-${Date.now()}.wav`)
    // Write a placeholder 44-byte WAV header
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(0, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(16000, 24)
    header.writeUInt32LE(32000, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(0, 40)
    fs.writeFileSync(tmpFile, header)
    fd = fs.openSync(tmpFile, 'r+')
  })

  afterEach(() => {
    try {
      fs.closeSync(fd)
    } catch {}
    try {
      fs.unlinkSync(tmpFile)
    } catch {}
  })

  it('writes correct RIFF size at offset 4', () => {
    updateWavHeader(fd, 32000)
    const buf = Buffer.alloc(4)
    fs.readSync(fd, buf, 0, 4, 4)
    expect(buf.readUInt32LE(0)).toBe(36 + 32000)
  })

  it('writes correct data size at offset 40', () => {
    updateWavHeader(fd, 64000)
    const buf = Buffer.alloc(4)
    fs.readSync(fd, buf, 0, 4, 40)
    expect(buf.readUInt32LE(0)).toBe(64000)
  })

  it('preserves RIFF and WAVE markers', () => {
    updateWavHeader(fd, 1000)
    const header = Buffer.alloc(44)
    fs.readSync(fd, header, 0, 44, 0)
    expect(header.toString('ascii', 0, 4)).toBe('RIFF')
    expect(header.toString('ascii', 8, 12)).toBe('WAVE')
    expect(header.toString('ascii', 36, 40)).toBe('data')
  })
})
