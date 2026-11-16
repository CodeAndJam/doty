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

  it('leaves the model alone when its own pick is one the DM has chosen before', () => {
    // Both a and c are evidenced; the model already leads with a, so there is
    // nothing to override and the calibrated probability stays authoritative.
    const probabilities = [0.41, 0.4, 0.19]
    const prefs = [
      { track: 'a.mp3', scene: 'peaceful' },
      { track: 'c.mp3', scene: 'peaceful' },
    ]
    expect(learnedPick({ probabilities, paths, preferences: prefs, scene: 'peaceful' })).toBeNull()
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

describe('learnedPick with rejections', () => {
  it('does not let one skip overrule a decisive model', () => {
    const probabilities = [0.8, 0.1, 0.1]
    const prefs = [{ track: 'a.mp3', scene: 'peaceful', source: 'reject' as const }]
    expect(learnedPick({ probabilities, paths, preferences: prefs, scene: 'peaceful' })).toBeNull()
  })

  it('demotes a track skipped twice in the same scene, even when the model is sure', () => {
    const probabilities = [0.8, 0.15, 0.05]
    const prefs = [
      { track: 'a.mp3', scene: 'peaceful', source: 'reject' as const },
      { track: 'a.mp3', scene: 'peaceful', source: 'reject' as const },
    ]
    const result = learnedPick({ probabilities, paths, preferences: prefs, scene: 'peaceful' })
    expect(result?.path).toBe('b.mp3')
    expect(result?.reason).toMatch(/skipped/i)
  })

  it('never resurrects a track the DM keeps rejecting', () => {
    const probabilities = [0.4, 0.35, 0.25]
    const prefs = [
      { track: 'a.mp3', scene: 'peaceful', source: 'reject' as const },
      { track: 'a.mp3', scene: 'peaceful', source: 'reject' as const },
      { track: 'b.mp3', scene: 'peaceful', source: 'reject' as const },
      { track: 'b.mp3', scene: 'peaceful', source: 'reject' as const },
    ]
    expect(learnedPick({ probabilities, paths, preferences: prefs, scene: 'peaceful' })?.path).toBe('c.mp3')
  })

  it('prefers a track the DM chose over one they merely did not reject', () => {
    const probabilities = [0.41, 0.4, 0.19]
    const prefs = [
      { track: 'b.mp3', scene: 'peaceful', source: 'manual' as const },
      { track: 'c.mp3', scene: 'peaceful', source: 'manual' as const },
    ]
    // Tie-break by probability among equal evidence: b (0.40) over c (0.19).
    expect(learnedPick({ probabilities, paths, preferences: prefs, scene: 'peaceful' })?.path).toBe('b.mp3')
  })
})
