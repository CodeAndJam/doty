/**
 * Mock HTMLAudioElement for testing audio hooks without a real DOM audio engine.
 * Supports controllable events, volume, currentTime, duration, and buffered ranges.
 */
import { vi } from 'vitest'

export interface MockAudioElement {
  src: string
  volume: number
  muted: boolean
  loop: boolean
  currentTime: number
  duration: number
  paused: boolean
  buffered: { length: number; start: (i: number) => number; end: (i: number) => number }

  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  setSinkId: ReturnType<typeof vi.fn>

  onended: (() => void) | null
  onerror: (() => void) | null
  ontimeupdate: (() => void) | null

  // Test helpers
  _simulateEnded: () => void
  _simulateError: () => void
  _simulateTimeUpdate: (time: number) => void
  _setDuration: (d: number) => void
  _setBuffered: (ranges: [number, number][]) => void
}

export function createMockAudio(duration = 180): MockAudioElement {
  const bufferedRanges: [number, number][] = [[0, duration]]

  const mock: MockAudioElement = {
    src: '',
    volume: 1,
    muted: false,
    loop: false,
    currentTime: 0,
    duration,
    paused: true,
    buffered: {
      get length() {
        return bufferedRanges.length
      },
      start: (i: number) => bufferedRanges[i]?.[0] ?? 0,
      end: (i: number) => bufferedRanges[i]?.[1] ?? 0,
    },

    play: vi.fn(() => {
      mock.paused = false
      return Promise.resolve()
    }),
    pause: vi.fn(() => {
      mock.paused = true
    }),
    setSinkId: vi.fn(() => Promise.resolve()),

    onended: null,
    onerror: null,
    ontimeupdate: null,

    _simulateEnded() {
      mock.onended?.()
    },
    _simulateError() {
      mock.onerror?.()
    },
    _simulateTimeUpdate(time: number) {
      mock.currentTime = time
      mock.ontimeupdate?.()
    },
    _setDuration(d: number) {
      mock.duration = d
    },
    _setBuffered(ranges: [number, number][]) {
      bufferedRanges.length = 0
      bufferedRanges.push(...ranges)
    },
  }

  return mock
}

/**
 * Install a global Audio constructor mock that returns MockAudioElement instances.
 * Returns a function to get the last created mock.
 */
export function installMockAudioConstructor() {
  const instances: MockAudioElement[] = []

  function MockAudioCtor(this: any, src?: string) {
    const mock = createMockAudio()
    if (src) mock.src = src
    instances.push(mock)
    Object.assign(this, mock)
    return mock
  }

  const MockAudio = vi.fn(MockAudioCtor) as unknown as typeof Audio

  vi.stubGlobal('Audio', MockAudio)

  return {
    MockAudio,
    get lastInstance() {
      return instances[instances.length - 1]
    },
    get allInstances() {
      return [...instances]
    },
    get instanceCount() {
      return instances.length
    },
    reset() {
      instances.length = 0
      ;(MockAudio as any).mockClear()
    },
  }
}
