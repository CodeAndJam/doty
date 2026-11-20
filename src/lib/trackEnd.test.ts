import { describe, expect, it } from 'vitest'
import { trackEndPlan } from './trackEnd'

describe('trackEndPlan', () => {
  it('repeats the playing cue in single mode when nothing is queued', () => {
    expect(trackEndPlan({ tracks: [], currentIndex: -1, playing: 'a.mp3', loopMode: 'single' })).toEqual({
      track: 'a.mp3',
      index: null,
    })
  })

  it('stops an empty queue unless single mode is on', () => {
    expect(trackEndPlan({ tracks: [], currentIndex: -1, playing: 'a.mp3', loopMode: 'off' })).toBeNull()
    expect(trackEndPlan({ tracks: [], currentIndex: -1, playing: 'a.mp3', loopMode: 'queue' })).toBeNull()
  })

  it('advances a queued next cue even in single mode', () => {
    expect(trackEndPlan({ tracks: ['a.mp3', 'b.mp3'], currentIndex: 0, playing: 'a.mp3', loopMode: 'single' })).toEqual(
      { track: 'b.mp3', index: 1 },
    )
  })

  it('repeats the last row in single mode once nothing is after it', () => {
    expect(trackEndPlan({ tracks: ['a.mp3', 'b.mp3'], currentIndex: 1, playing: 'b.mp3', loopMode: 'single' })).toEqual(
      { track: 'b.mp3', index: 1 },
    )
  })

  it('wraps in queue mode and stops otherwise', () => {
    expect(trackEndPlan({ tracks: ['a.mp3', 'b.mp3'], currentIndex: 1, playing: 'b.mp3', loopMode: 'queue' })).toEqual({
      track: 'a.mp3',
      index: 0,
    })
    expect(trackEndPlan({ tracks: ['a.mp3', 'b.mp3'], currentIndex: 1, playing: 'b.mp3', loopMode: 'off' })).toBeNull()
  })

  it('starts the queue head when the playing track is outside it', () => {
    expect(
      trackEndPlan({ tracks: ['a.mp3', 'b.mp3'], currentIndex: -1, playing: 'x.mp3', loopMode: 'single' }),
    ).toEqual({
      track: 'a.mp3',
      index: 0,
    })
  })
})
