import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QwenManager } from './qwen'
import type { TrackMetadata } from './analyzer'

const FILES = [
  'track-a.mp3', 'track-b.mp3', 'track-c.mp3', 'track-d.mp3', 'track-e.mp3',
  'track-f.mp3', 'track-g.mp3', 'track-h.mp3', 'track-i.mp3', 'track-j.mp3',
  'track-k.mp3',
]

const METADATA: Record<string, TrackMetadata> = {
  'track-a.mp3': { bpm: 128, bpmConfidence: 0.9, key: 'C', scale: 'major', danceability: 0.8, energy: 0.7, duration: 240, mtime: 0 },
  'track-b.mp3': { bpm: 140, bpmConfidence: 0.8, key: 'A', scale: 'minor', danceability: 0.6, energy: 0.9, duration: 200, mtime: 0 },
}

function makeOutput(filenames: string[]) {
  return [{ generated_text: [{ role: 'assistant', content: JSON.stringify(filenames) }] }]
}

function makeManager() {
  const mockGen = vi.fn()
  const mockPipeline = vi.fn().mockResolvedValue(mockGen)
  const manager = new QwenManager(mockPipeline)
  return { manager, mockGen, mockPipeline }
}

describe('QwenManager', () => {
  describe('empty files list', () => {
    it('returns [] without calling the model', async () => {
      const { manager, mockPipeline } = makeManager()
      const result = await manager.recommend('energetic crowd', [])
      expect(result).toEqual([])
      expect(mockPipeline).not.toHaveBeenCalled()
    })
  })

  describe('model loading', () => {
    it('loads the model lazily on first call', async () => {
      const { manager, mockGen, mockPipeline } = makeManager()
      mockGen.mockResolvedValueOnce(makeOutput(FILES.slice(0, 5)))
      await manager.recommend('test', FILES)
      expect(mockPipeline).toHaveBeenCalledOnce()
      expect(mockPipeline).toHaveBeenCalledWith(
        'text-generation',
        'onnx-community/Qwen3-0.6B-ONNX',
        { dtype: 'q4', device: 'cpu' },
      )
    })

    it('reuses cached generator on subsequent calls', async () => {
      const { manager, mockGen, mockPipeline } = makeManager()
      mockGen.mockResolvedValue(makeOutput(FILES.slice(0, 5)))
      await manager.recommend('first', FILES)
      await manager.recommend('second', FILES)
      expect(mockPipeline).toHaveBeenCalledOnce()
    })
  })

  describe('happy path', () => {
    it('returns valid filenames from model output', async () => {
      const { manager, mockGen } = makeManager()
      const expected = FILES.slice(0, 5)
      mockGen.mockResolvedValueOnce(makeOutput(expected))
      const result = await manager.recommend('dark ambient', FILES)
      expect(result).toEqual(expected)
    })

    it('passes correct generation params to the model', async () => {
      const { manager, mockGen } = makeManager()
      mockGen.mockResolvedValueOnce(makeOutput(FILES.slice(0, 5)))
      await manager.recommend('test', FILES)
      expect(mockGen).toHaveBeenCalledWith(
        expect.any(Array),
        { max_new_tokens: 150, temperature: 0.3, do_sample: true, thinking: false },
      )
    })

    it('caps results at 5 tracks', async () => {
      const { manager, mockGen } = makeManager()
      mockGen.mockResolvedValueOnce(makeOutput(FILES)) // 11 files
      const result = await manager.recommend('test', FILES)
      expect(result.length).toBeLessThanOrEqual(5)
    })
  })

  describe('output filtering', () => {
    it('filters out filenames not in the provided list', async () => {
      const { manager, mockGen } = makeManager()
      const output = ['track-a.mp3', 'nonexistent.mp3', 'track-b.mp3', 'track-c.mp3', 'track-d.mp3']
      mockGen.mockResolvedValueOnce(makeOutput(output))
      const result = await manager.recommend('test', FILES)
      expect(result).not.toContain('nonexistent.mp3')
      expect(result.every((f) => FILES.includes(f))).toBe(true)
    })
  })

  describe('fallback behaviour', () => {
    it('falls back to first 5 files when model returns no JSON array', async () => {
      const { manager, mockGen } = makeManager()
      mockGen.mockResolvedValueOnce([{ generated_text: [{ role: 'assistant', content: 'Sorry.' }] }])
      const result = await manager.recommend('test', FILES)
      expect(result).toEqual(FILES.slice(0, 5))
    })

    it('falls back to first 5 files when JSON array has no valid filenames', async () => {
      const { manager, mockGen } = makeManager()
      mockGen.mockResolvedValueOnce(makeOutput(['ghost1.mp3', 'ghost2.mp3']))
      const result = await manager.recommend('test', FILES)
      expect(result).toEqual(FILES.slice(0, 5))
    })

    it('falls back to first 5 files when model throws', async () => {
      const { manager, mockGen } = makeManager()
      mockGen.mockRejectedValueOnce(new Error('OOM'))
      const result = await manager.recommend('test', FILES)
      expect(result).toEqual(FILES.slice(0, 5))
    })

    it('falls back to first 5 files when generated_text is missing', async () => {
      const { manager, mockGen } = makeManager()
      mockGen.mockResolvedValueOnce([{}])
      const result = await manager.recommend('test', FILES)
      expect(result).toEqual(FILES.slice(0, 5))
    })
  })

  describe('prompt construction', () => {
    it('includes BPM and key when metadata is provided', async () => {
      const { manager, mockGen } = makeManager()
      mockGen.mockResolvedValueOnce(makeOutput(FILES.slice(0, 5)))
      await manager.recommend('test', FILES, METADATA)
      const messages: { role: string; content: string }[] = mockGen.mock.calls[0][0]
      const userMsg = messages.find((m) => m.role === 'user')!
      expect(userMsg.content).toContain('BPM: 128')
      expect(userMsg.content).toContain('Am') // A minor
    })

    it('formats tracks without metadata gracefully', async () => {
      const { manager, mockGen } = makeManager()
      mockGen.mockResolvedValueOnce(makeOutput(FILES.slice(0, 5)))
      await manager.recommend('test', FILES, {})
      const messages: { role: string; content: string }[] = mockGen.mock.calls[0][0]
      const userMsg = messages.find((m) => m.role === 'user')!
      expect(userMsg.content).toContain('track-a.mp3')
      expect(userMsg.content).not.toContain('BPM')
    })

    it('truncates transcript to 600 chars in the prompt', async () => {
      const { manager, mockGen } = makeManager()
      mockGen.mockResolvedValueOnce(makeOutput(FILES.slice(0, 5)))
      await manager.recommend('x'.repeat(1000), FILES)
      const messages: { role: string; content: string }[] = mockGen.mock.calls[0][0]
      const userMsg = messages.find((m) => m.role === 'user')!
      const match = userMsg.content.match(/"([^"]+)"/)
      expect(match![1].length).toBeLessThanOrEqual(600)
    })

    it('limits song list to 100 tracks in the prompt', async () => {
      const { manager, mockGen } = makeManager()
      const manyFiles = Array.from({ length: 150 }, (_, i) => `track-${i}.mp3`)
      mockGen.mockResolvedValueOnce(makeOutput(manyFiles.slice(0, 5)))
      await manager.recommend('test', manyFiles)
      const messages: { role: string; content: string }[] = mockGen.mock.calls[0][0]
      const userMsg = messages.find((m) => m.role === 'user')!
      expect(userMsg.content).not.toContain('track-100.mp3')
    })
  })
})
