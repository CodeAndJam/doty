import { describe, expect, it } from 'vitest'
import { resolveLane, showInMusicPanel } from './lane'

describe('resolveLane', () => {
  it('lets the DM override everything', () => {
    const decision = resolveLane({ path: 'door.mp3', override: 'music', folderLane: 'sfx', duration: 2 })
    expect(decision).toEqual({ lane: 'music', source: 'override', kind: 'music' })
  })

  it('takes a six-second file as an effect even when it lives in the music folder', () => {
    expect(resolveLane({ path: 'Sounds/door slam.mp3', folderLane: 'music', duration: 6 })).toMatchObject({
      lane: 'sfx',
      source: 'classifier',
    })
  })

  it('keeps a three-minute file as a cue even when it lives in the effects folder', () => {
    expect(resolveLane({ path: 'campfire.wav', folderLane: 'sfx', duration: 180 })).toMatchObject({
      lane: 'music',
      source: 'classifier',
    })
  })

  it('uses the audio verdict in the band duration cannot answer', () => {
    expect(resolveLane({ path: 'loop.wav', folderLane: 'music', duration: 30, audio: 'sfx' }).lane).toBe('sfx')
  })

  it('falls back to the folder when nothing else knows', () => {
    // With one folder this is also the default: a cue is the cheaper mistake.
    expect(resolveLane({ path: 'loop.wav', folderLane: 'sfx', duration: 30 })).toMatchObject({
      lane: 'sfx',
      source: 'folder',
    })
    expect(resolveLane({ path: 'loop.wav', folderLane: null, duration: 30 })).toMatchObject({
      lane: 'music',
      source: 'folder',
    })
  })
})

describe('showInMusicPanel', () => {
  it('hides an effect only when there is an effects shelf to hold it', () => {
    expect(showInMusicPanel('sfx', true)).toBe(false)
    expect(showInMusicPanel('sfx', false)).toBe(true)
    expect(showInMusicPanel('music', true)).toBe(true)
  })
})
