import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAudioPlayer } from '../../hooks/useAudioPlayer'
import { installMockAudioConstructor } from '../mocks/audio'

// Stub localStorage for useVolume / useLoop persistence
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
})

describe('useAudioPlayer — seek', () => {
  let audioMocks: ReturnType<typeof installMockAudioConstructor>
  let rafCallbacks: (() => void)[]

  beforeEach(() => {
    storage.clear()
    audioMocks = installMockAudioConstructor()
    rafCallbacks = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb as () => void)
      return rafCallbacks.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function flushRAF() {
    const cbs = [...rafCallbacks]
    rafCallbacks.length = 0
    cbs.forEach(cb => cb())
  }

  const defaultOpts = {
    speakerDeviceId: undefined,
    onNoFolder: vi.fn(),
    musicFolder: '/music',
  }

  function startPlaying() {
    const hook = renderHook(() => useAudioPlayer(defaultOpts))
    // Play a track
    act(() => { hook.result.current.playTrack('song.mp3') })
    const audio = audioMocks.lastInstance
    // Simulate metadata loaded — set duration
    audio._setDuration(200)
    audio.currentTime = 0
    // Flush initial rAF to pick up duration
    act(() => { flushRAF() })
    return { hook, audio }
  }

  it('seekTo sets audio currentTime and updates progress', () => {
    const { hook, audio } = startPlaying()

    act(() => { hook.result.current.seekTo(0.5) })

    expect(audio.currentTime).toBe(100) // 0.5 * 200
    expect(hook.result.current.progress).toBe(0.5)
    expect(hook.result.current.currentTime).toBe(100)
  })

  it('seekTo does nothing when duration is not yet available (NaN)', () => {
    const hook = renderHook(() => useAudioPlayer(defaultOpts))
    act(() => { hook.result.current.playTrack('song.mp3') })
    const audio = audioMocks.lastInstance

    // Duration is NaN (metadata not loaded)
    audio._setDuration(NaN)

    act(() => { hook.result.current.seekTo(0.5) })

    // Should not crash, currentTime stays at 0
    expect(audio.currentTime).toBe(0)
    expect(hook.result.current.progress).toBe(0)
  })

  it('seekTo works after metadata loads even if initially NaN', () => {
    const hook = renderHook(() => useAudioPlayer(defaultOpts))
    act(() => { hook.result.current.playTrack('song.mp3') })
    const audio = audioMocks.lastInstance

    // Initially NaN
    audio._setDuration(NaN)
    act(() => { hook.result.current.seekTo(0.5) })
    expect(audio.currentTime).toBe(0)

    // Metadata loads
    audio._setDuration(200)
    act(() => { flushRAF() })

    // Now seek should work
    act(() => { hook.result.current.seekTo(0.5) })
    expect(audio.currentTime).toBe(100)
    expect(hook.result.current.progress).toBe(0.5)
  })

  it('rAF loop does not overwrite seek position while seeking', () => {
    const { hook, audio } = startPlaying()

    // Start seeking
    act(() => { hook.result.current.seekStart() })

    // User seeks to 75%
    act(() => { hook.result.current.seekTo(0.75) })
    expect(hook.result.current.progress).toBe(0.75)

    // Simulate audio element still at old position (hasn't caught up)
    audio.currentTime = 10

    // rAF fires — should NOT overwrite the seek position
    act(() => { flushRAF() })
    expect(hook.result.current.progress).toBe(0.75)

    // End seeking
    act(() => { hook.result.current.seekEnd() })

    // Now rAF should read from audio element again
    audio.currentTime = 150 // audio caught up to seek
    act(() => { flushRAF() })
    expect(hook.result.current.progress).toBe(0.75) // 150/200
  })

  it('rAF loop resumes reading audio position after seekEnd', () => {
    const { hook, audio } = startPlaying()

    // Seek
    act(() => { hook.result.current.seekStart() })
    act(() => { hook.result.current.seekTo(0.5) })
    act(() => { hook.result.current.seekEnd() })

    // Audio element has moved to the seeked position
    audio.currentTime = 100
    act(() => { flushRAF() })
    expect(hook.result.current.progress).toBe(0.5) // 100/200

    // Audio continues playing
    audio.currentTime = 120
    act(() => { flushRAF() })
    expect(hook.result.current.progress).toBe(0.6) // 120/200
  })

  it('single click seek (no drag) works correctly', () => {
    const { hook, audio } = startPlaying()

    // Simulate a click: seekStart → seekTo → seekEnd in quick succession
    act(() => {
      hook.result.current.seekStart()
      hook.result.current.seekTo(0.3)
      hook.result.current.seekEnd()
    })

    expect(audio.currentTime).toBe(60) // 0.3 * 200
    expect(hook.result.current.progress).toBe(0.3)

    // Audio element confirms the position
    audio.currentTime = 60
    act(() => { flushRAF() })
    expect(hook.result.current.progress).toBe(0.3)
  })

  it('seek to 0% works', () => {
    const { hook, audio } = startPlaying()
    audio.currentTime = 100
    act(() => { flushRAF() })

    act(() => { hook.result.current.seekTo(0) })
    expect(audio.currentTime).toBe(0)
    expect(hook.result.current.progress).toBe(0)
  })

  it('seek to 100% works', () => {
    const { hook, audio } = startPlaying()

    act(() => { hook.result.current.seekTo(1) })
    expect(audio.currentTime).toBe(200)
    expect(hook.result.current.progress).toBe(1)
  })

  it('multiple rapid seeks use the last value', () => {
    const { hook, audio } = startPlaying()

    act(() => {
      hook.result.current.seekStart()
      hook.result.current.seekTo(0.1)
      hook.result.current.seekTo(0.3)
      hook.result.current.seekTo(0.7)
      hook.result.current.seekEnd()
    })

    expect(audio.currentTime).toBe(140) // 0.7 * 200
    expect(hook.result.current.progress).toBe(0.7)
  })
})
