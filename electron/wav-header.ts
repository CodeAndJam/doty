import fs from 'node:fs'

/**
 * Update WAV header in-place with current byte count.
 * Makes the WAV valid up to the last update point if the app crashes.
 */
export function updateWavHeader(fd: number, dataBytes: number): void {
  const fileSizeBuf = Buffer.alloc(4)
  fileSizeBuf.writeUInt32LE(36 + dataBytes)
  fs.writeSync(fd, fileSizeBuf, 0, 4, 4)

  const dataSizeBuf = Buffer.alloc(4)
  dataSizeBuf.writeUInt32LE(dataBytes)
  fs.writeSync(fd, dataSizeBuf, 0, 4, 40)
}
