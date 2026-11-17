import { describe, expect, it } from 'vitest'
import { unpackedBinaryPath } from './ffmpeg'

describe('ffmpeg binary path', () => {
  it('moves a packaged path out of app.asar', () => {
    expect(
      unpackedBinaryPath('/Applications/Doty.app/Contents/Resources/app.asar/node_modules/ffmpeg-static/ffmpeg'),
    ).toBe('/Applications/Doty.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg')
  })

  it('handles Windows separators', () => {
    expect(unpackedBinaryPath('C:\\Doty\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe')).toBe(
      'C:\\Doty\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe',
    )
  })

  it('leaves dev, already-unpacked and lookalike paths alone', () => {
    for (const path of [
      '/repo/node_modules/ffmpeg-static/ffmpeg',
      '/Applications/Doty.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg',
      '/opt/app.asar.bak/ffmpeg',
      '/opt/my-app.asar/ffmpeg',
    ]) {
      expect(unpackedBinaryPath(path)).toBe(path)
    }
  })

  it('falls back to PATH when ffmpeg-static has no binary for this platform', () => {
    expect(unpackedBinaryPath(null)).toBe('ffmpeg')
  })
})
