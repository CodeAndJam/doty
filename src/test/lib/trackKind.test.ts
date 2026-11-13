import { describe, expect, it } from 'vitest'
import { classifyTrack } from '../../lib/trackKind'

describe('classifyTrack', () => {
  it('calls a four-second door slam a sound effect, whatever its folder', () => {
    expect(classifyTrack({ path: 'Combat/Boss/Door Slam.mp3', duration: 4 })).toBe('sfx')
  })

  it('calls a three-minute cue music, even in a folder named effects', () => {
    expect(classifyTrack({ path: 'Effects/Ambush Theme.mp3', duration: 184 })).toBe('music')
  })

  it('uses duration over a misleading path', () => {
    // The reported case: a sounds pack dropped inside the score.
    expect(classifyTrack({ path: 'Music/SFX/Sword Clash.wav', duration: 2.5 })).toBe('sfx')
  })

  it('falls back to names when duration is missing', () => {
    expect(classifyTrack({ path: 'SFX/roar.wav' })).toBe('sfx')
    expect(classifyTrack({ path: '', genre: 'Soundtrack' })).toBe('music')
  })

  it('does not treat the tagger default "Music" as evidence', () => {
    // "Music" is written on every file that has no better genre; it proves nothing.
    expect(classifyTrack({ path: 'Unknown/thunder.mp3', genre: 'Music' })).toBe('unknown')
  })

  it('leaves a middling clip unknown rather than guessing', () => {
    expect(classifyTrack({ path: 'Misc/track 7.mp3', duration: 30 })).toBe('unknown')
  })

  it('treats a missing or zero duration as absent', () => {
    expect(classifyTrack({ path: 'SFX/hit.wav', duration: 0 })).toBe('sfx')
    expect(classifyTrack({ path: 'SFX/hit.wav' })).toBe('sfx')
  })
})
