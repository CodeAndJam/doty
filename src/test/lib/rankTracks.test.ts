import { describe, expect, it, vi } from 'vitest'
import { describeTrack, rankTracks } from '../../lib/rankTracks'

const signals = { metadata: {}, tagsMap: {}, playFrequencies: {} }

describe('rankTracks', () => {
  it('returns an empty result without candidates', async () => {
    const decide = vi.fn()
    await expect(rankTracks('battle', [], signals, { ready: true, decide })).resolves.toEqual({
      files: [],
      confidence: 0,
      ranker: null,
    })
    expect(decide).not.toHaveBeenCalled()
  })

  it('stays on the heuristic while the model is not ready', async () => {
    const decide = vi.fn()
    const result = await rankTracks('battle', ['a.mp3', 'b.mp3'], signals, { ready: false, decide })

    expect(result.ranker).toBe('heuristic')
    expect(result.files.sort()).toEqual(['a.mp3', 'b.mp3'])
    expect(decide).not.toHaveBeenCalled()
  })

  it('orders candidates by the model probabilities and reports the top one', async () => {
    // Already-calibrated probabilities, in candidate order: the second wins.
    const decide = vi.fn(async (_prompt: string, candidates: string[]) =>
      candidates.map((_, i) => (i === 0 ? 0.1 : 0.82)),
    )
    const result = await rankTracks('battle', ['a.mp3', 'b.mp3'], signals, { ready: true, decide })

    expect(result.ranker).toBe('model')
    expect(result.files).toEqual(['b.mp3', 'a.mp3'])
    // The top probability is passed through, not softmaxed again.
    expect(result.confidence).toBeCloseTo(0.82, 6)
    expect(decide).toHaveBeenCalledTimes(1)
  })

  it('falls back to the heuristic when the model call fails', async () => {
    const decide = vi.fn(async () => {
      throw new Error('worker crashed')
    })
    const result = await rankTracks('battle', ['a.mp3', 'b.mp3'], signals, { ready: true, decide })

    expect(result.ranker).toBe('heuristic')
    expect(result.files.sort()).toEqual(['a.mp3', 'b.mp3'])
  })
})

describe('describeTrack', () => {
  it('keeps the description inside the model option budget', () => {
    const text = describeTrack('battle-of-the-ancients.mp3', { genre: 'Orchestral', bpm: 132, energy: 0.83 } as never, [
      'combat',
      'drums',
      'epic',
      'brass',
    ])
    expect(text).toBe('battle of the ancients — Orchestral, 132 BPM, energy 0.8, combat, drums')
    // Two tags only: the model gives every option about 24 tokens.
    expect(text).not.toContain('epic')
  })

  it('falls back to the name alone when there is no metadata', () => {
    expect(describeTrack('tavern_theme.mp3', undefined)).toBe('tavern theme')
  })
})
