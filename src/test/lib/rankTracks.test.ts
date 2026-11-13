import { describe, expect, it, vi } from 'vitest'
import { rankTracks } from '../../lib/rankTracks'

const signals = { metadata: {}, tagsMap: {}, playFrequencies: {} }

describe('rankTracks', () => {
  it('returns an empty result without candidates', async () => {
    const score = vi.fn()
    await expect(rankTracks('battle', [], signals, { ready: true, score })).resolves.toEqual({
      files: [],
      confidence: 0,
      ranker: null,
    })
    expect(score).not.toHaveBeenCalled()
  })

  it('stays on the heuristic while the reranker is not ready', async () => {
    const score = vi.fn()
    const result = await rankTracks('battle', ['a.mp3', 'b.mp3'], signals, { ready: false, score })

    expect(result.ranker).toBe('heuristic')
    expect(result.files.sort()).toEqual(['a.mp3', 'b.mp3'])
    expect(score).not.toHaveBeenCalled()
  })

  it('reorders the candidates by reranker score when ready', async () => {
    const score = vi.fn(async (pairs: Array<{ text: string; text_pair: string }>) =>
      pairs.map((_, i) => (i === 0 ? 0 : 10)),
    )
    const result = await rankTracks('battle', ['a.mp3', 'b.mp3'], signals, { ready: true, score })

    expect(result.ranker).toBe('reranker')
    expect(result.files).toEqual(['b.mp3', 'a.mp3'])
    expect(result.confidence).toBeGreaterThan(0.9)
    expect(score).toHaveBeenCalledTimes(1)
  })

  it('falls back to the heuristic when scoring fails', async () => {
    const score = vi.fn(async () => {
      throw new Error('worker crashed')
    })
    const result = await rankTracks('battle', ['a.mp3', 'b.mp3'], signals, { ready: true, score })

    expect(result.ranker).toBe('heuristic')
    expect(result.files.sort()).toEqual(['a.mp3', 'b.mp3'])
  })
})
