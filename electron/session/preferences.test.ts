import { describe, expect, it } from 'vitest'
import { learnedPick } from './preferences'

const paths = ['a.mp3', 'b.mp3', 'c.mp3']

describe('learnedPick', () => {
  it('breaks a tie the model could not break, using what the DM chose before', () => {
    // 0.41 vs 0.40: the model is effectively undecided, so the DM's history decides.
    const probabilities = [0.41, 0.4, 0.19]
    const prefs = [{ track: 'b.mp3', scene: 'peaceful' }]
    expect(learnedPick({ probabilities, paths, preferences: prefs, scene: 'peaceful' })?.path).toBe('b.mp3')
  })

  it('never overrules a decisive model', () => {
    const probabilities = [0.8, 0.1, 0.1]
    const prefs = [{ track: 'b.mp3', scene: 'peaceful' }]
    expect(learnedPick({ probabilities, paths, preferences: prefs, scene: 'peaceful' })).toBeNull()
  })

  it('ignores preferences learned in another scene', () => {
    const probabilities = [0.41, 0.4, 0.19]
    const prefs = [{ track: 'b.mp3', scene: 'combat' }]
    expect(learnedPick({ probabilities, paths, preferences: prefs, scene: 'peaceful' })).toBeNull()
  })

  it('ignores a preference the model was not offered', () => {
    const probabilities = [0.41, 0.4, 0.19]
    const prefs = [{ track: 'gone.mp3', scene: 'peaceful' }]
    expect(learnedPick({ probabilities, paths, preferences: prefs, scene: 'peaceful' })).toBeNull()
  })

  it('uses the most recent of several learned tracks', () => {
    const probabilities = [0.41, 0.4, 0.19]
    const prefs = [
      { track: 'a.mp3', scene: 'peaceful' },
      { track: 'c.mp3', scene: 'peaceful' },
    ]
    // Callers pass newest first.
    expect(learnedPick({ probabilities, paths, preferences: prefs, scene: 'peaceful' })?.path).toBe('a.mp3')
  })

  it('says why, so the decision log explains an override', () => {
    const result = learnedPick({
      probabilities: [0.41, 0.4, 0.19],
      paths,
      preferences: [{ track: 'b.mp3', scene: 'peaceful' }],
      scene: 'peaceful',
    })
    expect(result?.reason).toMatch(/learned/i)
  })

  it('does nothing when the scene is unknown', () => {
    const probabilities = [0.41, 0.4, 0.19]
    const prefs = [{ track: 'b.mp3', scene: 'peaceful' }]
    expect(learnedPick({ probabilities, paths, preferences: prefs, scene: null })).toBeNull()
  })
})
