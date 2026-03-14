import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { audioMime, handleMusicRequest, parseMusicUrl } from './music-protocol'

describe('music-protocol', () => {
  // Create a temp directory with a small test file
  let tmpDir: string
  let testFile: string
  const testContent = Buffer.alloc(1000) // 1000 bytes of zeros

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doty-music-test-'))
    testFile = 'test-track.mp3'
    fs.writeFileSync(path.join(tmpDir, testFile), testContent)
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('audioMime', () => {
    it('returns correct MIME for known extensions', () => {
      expect(audioMime('.mp3')).toBe('audio/mpeg')
      expect(audioMime('.flac')).toBe('audio/flac')
      expect(audioMime('.wav')).toBe('audio/wav')
      expect(audioMime('.m4a')).toBe('audio/mp4')
      expect(audioMime('.ogg')).toBe('audio/ogg')
      expect(audioMime('.aac')).toBe('audio/aac')
    })

    it('is case-insensitive', () => {
      expect(audioMime('.MP3')).toBe('audio/mpeg')
      expect(audioMime('.Flac')).toBe('audio/flac')
    })

    it('returns octet-stream for unknown extensions', () => {
      expect(audioMime('.xyz')).toBe('application/octet-stream')
      expect(audioMime('.txt')).toBe('application/octet-stream')
    })
  })

  describe('parseMusicUrl', () => {
    it('extracts filename from music://play/ URL', () => {
      expect(parseMusicUrl('music://play/Campfire.mp3')).toBe('Campfire.mp3')
    })

    it('decodes URI-encoded filenames', () => {
      expect(parseMusicUrl('music://play/My%20Track.mp3')).toBe('My Track.mp3')
    })

    it('handles subdirectory paths', () => {
      expect(parseMusicUrl('music://play/ambient%2Fforest.flac')).toBe('ambient/forest.flac')
    })

    it('handles URLs without play/ prefix', () => {
      expect(parseMusicUrl('music://Campfire.mp3')).toBe('Campfire.mp3')
    })
  })

  describe('handleMusicRequest', () => {
    it('returns 404 for non-existent file', () => {
      const resp = handleMusicRequest({ url: 'music://play/nonexistent.mp3', rangeHeader: null }, tmpDir)
      expect(resp.status).toBe(404)
    })

    it('returns 200 with full file for request without Range header', () => {
      const resp = handleMusicRequest({ url: `music://play/${testFile}`, rangeHeader: null }, tmpDir)
      expect(resp.status).toBe(200)
      expect(resp.headers.get('Content-Type')).toBe('audio/mpeg')
      expect(resp.headers.get('Content-Length')).toBe('1000')
      expect(resp.headers.get('Accept-Ranges')).toBe('bytes')
    })

    it('returns 206 with partial content for Range request', () => {
      const resp = handleMusicRequest({ url: `music://play/${testFile}`, rangeHeader: 'bytes=100-199' }, tmpDir)
      expect(resp.status).toBe(206)
      expect(resp.headers.get('Content-Type')).toBe('audio/mpeg')
      expect(resp.headers.get('Content-Length')).toBe('100')
      expect(resp.headers.get('Content-Range')).toBe('bytes 100-199/1000')
      expect(resp.headers.get('Accept-Ranges')).toBe('bytes')
    })

    it('handles open-ended Range (bytes=500-)', () => {
      const resp = handleMusicRequest({ url: `music://play/${testFile}`, rangeHeader: 'bytes=500-' }, tmpDir)
      expect(resp.status).toBe(206)
      expect(resp.headers.get('Content-Length')).toBe('500')
      expect(resp.headers.get('Content-Range')).toBe('bytes 500-999/1000')
    })

    it('handles Range starting at 0', () => {
      const resp = handleMusicRequest({ url: `music://play/${testFile}`, rangeHeader: 'bytes=0-' }, tmpDir)
      expect(resp.status).toBe(206)
      expect(resp.headers.get('Content-Length')).toBe('1000')
      expect(resp.headers.get('Content-Range')).toBe('bytes 0-999/1000')
    })

    it('returns correct body bytes for a Range request', async () => {
      // Write known content
      const knownFile = 'known.mp3'
      const knownContent = Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
      fs.writeFileSync(path.join(tmpDir, knownFile), knownContent)

      const resp = handleMusicRequest({ url: `music://play/${knownFile}`, rangeHeader: 'bytes=10-14' }, tmpDir)
      expect(resp.status).toBe(206)
      expect(resp.headers.get('Content-Length')).toBe('5')

      // Read the response body
      const reader = resp.body!.getReader()
      const chunks: Uint8Array[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      const body = Buffer.concat(chunks)
      expect(body.toString()).toBe('KLMNO') // bytes 10-14 of A-Z
    })
  })
})
