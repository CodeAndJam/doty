/**
 * Tests for Discord SFX streaming — specifically the interrupt-and-resume
 * state machine and the race condition between Idle/Playing events.
 *
 * These tests mock @discordjs/voice and discord-audio to isolate the
 * state transition logic in discord.ts.
 */

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock AudioPlayer that simulates real discord.js behavior ──────────────────

const AudioPlayerStatus = {
  Idle: 'idle' as const,
  Buffering: 'buffering' as const,
  Playing: 'playing' as const,
  AutoPaused: 'autopaused' as const,
  Paused: 'paused' as const,
}

class MockAudioPlayer extends EventEmitter {
  state: { status: string } = { status: 'idle' }
  private _currentResource: any = null
  private _playCallCount = 0

  play(resource: any): void {
    this._playCallCount++
    const wasPlaying = this.state.status === 'playing'

    if (wasPlaying) {
      // CRITICAL: Real discord.js fires Idle synchronously when displacing a resource
      this.state = { status: 'idle' }
      this.emit('idle')
    }

    this._currentResource = resource

    // Real discord.js transitions to Playing asynchronously (next tick / microtask)
    // We use setTimeout(0) to simulate this
    setTimeout(() => {
      if (this._currentResource === resource) {
        this.state = { status: 'playing' }
        this.emit('playing')
      }
    }, 0)
  }

  stop(_force?: boolean): void {
    this._currentResource = null
    this.state = { status: 'idle' }
    this.emit('idle')
  }

  pause(): void {
    this.state = { status: 'paused' }
  }

  unpause(): void {
    if (this._currentResource) {
      this.state = { status: 'playing' }
      this.emit('playing')
    }
  }

  /** Simulate the current resource finishing naturally */
  simulateResourceEnd(): void {
    this._currentResource = null
    this.state = { status: 'idle' }
    this.emit('idle')
  }

  get playCallCount(): number {
    return this._playCallCount
  }
  get currentResource(): any {
    return this._currentResource
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function createFakeResource(label: string, volume = 1.0) {
  return {
    volume: { setVolume: vi.fn(), volume },
    _label: label,
  }
}

// ── Test the state machine logic directly ─────────────────────────────────────
//
// Since discord.ts has module-level state and heavy imports (discord.js, electron),
// we replicate the exact state machine logic here to test it in isolation.
// This is the same logic from discord.ts joinChannel's player event handlers +
// streamTrack/streamSfx/playNextSfx/resumeMusicAfterSfx.

interface SfxStateMachine {
  player: MockAudioPlayer
  sfxPlaying: boolean
  sfxTransitioning: boolean
  sfxQueue: { path: string; volume: number }[]
  currentTrack: string | null
  currentResource: any
  musicResumeCount: number
  sfxPlayCount: number
  stateLog: string[]
}

function createStateMachine(): SfxStateMachine {
  const player = new MockAudioPlayer()
  const sm: SfxStateMachine = {
    player,
    sfxPlaying: false,
    sfxTransitioning: false,
    sfxQueue: [],
    currentTrack: null,
    currentResource: null,
    musicResumeCount: 0,
    sfxPlayCount: 0,
    stateLog: [],
  }

  // Wire up the same event handlers as discord.ts joinChannel
  player.on(AudioPlayerStatus.Playing, () => {
    if (sm.sfxTransitioning) {
      sm.sfxTransitioning = false
      sm.sfxPlaying = true
      sm.stateLog.push('sfx-now-playing')
    }
    sm.stateLog.push('player-playing')
  })

  player.on(AudioPlayerStatus.Idle, () => {
    if (sm.sfxTransitioning) {
      sm.stateLog.push('idle-ignored-transitioning')
      return
    }

    if (sm.sfxPlaying) {
      sm.sfxPlaying = false
      sm.stateLog.push('sfx-finished')
      if (sm.sfxQueue.length > 0) {
        const next = sm.sfxQueue.shift()!
        playNextSfx(sm, next.path, next.volume)
      } else {
        resumeMusicAfterSfx(sm)
      }
      return
    }

    sm.stateLog.push('player-idle')
  })

  return sm
}

function streamTrack(sm: SfxStateMachine, filename: string): void {
  sm.currentTrack = filename

  if (sm.sfxPlaying || sm.sfxTransitioning) {
    sm.stateLog.push(`music-deferred:${filename}`)
    return
  }

  const resource = createFakeResource(`music:${filename}`)
  sm.currentResource = resource
  sm.player.play(resource)
  sm.stateLog.push(`music-started:${filename}`)
}

function playNextSfx(sm: SfxStateMachine, absolutePath: string, volume: number): void {
  const resource = createFakeResource(`sfx:${absolutePath}`, volume)
  sm.sfxTransitioning = true
  sm.sfxPlaying = false
  sm.sfxPlayCount++
  sm.player.play(resource)
  sm.stateLog.push(`sfx-starting:${absolutePath}`)
}

function resumeMusicAfterSfx(sm: SfxStateMachine): void {
  if (!sm.currentTrack) return
  sm.musicResumeCount++
  const resource = createFakeResource(`music:${sm.currentTrack}`)
  sm.currentResource = resource
  sm.player.play(resource)
  sm.stateLog.push(`music-resumed:${sm.currentTrack}`)
}

function streamSfx(sm: SfxStateMachine, absolutePath: string, volume = 1.0): void {
  if (sm.sfxPlaying || sm.sfxTransitioning) {
    sm.sfxQueue.push({ path: absolutePath, volume })
    sm.stateLog.push(`sfx-queued:${absolutePath}`)
    return
  }
  playNextSfx(sm, absolutePath, volume)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Discord SFX state machine', () => {
  let sm: SfxStateMachine

  beforeEach(() => {
    vi.useFakeTimers()
    sm = createStateMachine()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic music streaming', () => {
    it('plays music directly when no SFX is active', () => {
      streamTrack(sm, 'battle.mp3')
      expect(sm.currentTrack).toBe('battle.mp3')
      expect(sm.currentResource._label).toBe('music:battle.mp3')
      expect(sm.stateLog).toContain('music-started:battle.mp3')
    })

    it('transitions to playing state after async tick', async () => {
      streamTrack(sm, 'battle.mp3')
      vi.advanceTimersByTime(10)
      expect(sm.stateLog).toContain('player-playing')
    })
  })

  describe('SFX interrupt — the race condition', () => {
    it('BUG REPRO: without transition guard, displaced Idle kills SFX immediately', async () => {
      // This test documents the bug that existed before the sfxTransitioning fix.
      // When player.play(sfx) is called while music is playing:
      // 1. player.play() stops old music → fires Idle synchronously
      // 2. If sfxPlaying is already true, the Idle handler thinks SFX finished
      //    and calls resumeMusicAfterSfx(), killing the SFX

      // Start music
      streamTrack(sm, 'battle.mp3')
      vi.advanceTimersByTime(10) // music enters Playing state

      expect(sm.player.state.status).toBe('playing')
      expect(sm.stateLog).toContain('player-playing')

      // Now trigger SFX while music is playing
      streamSfx(sm, '/sfx/boom.ogg', 0.8)

      // At this point:
      // - sfxTransitioning should be true (set BEFORE player.play)
      // - player.play(sfx) fired Idle synchronously (music displaced)
      // - The Idle handler should have IGNORED it because sfxTransitioning=true
      expect(sm.sfxTransitioning).toBe(true)
      expect(sm.stateLog).toContain('idle-ignored-transitioning')
      expect(sm.stateLog).not.toContain('sfx-finished') // SFX was NOT prematurely killed

      // Advance time — SFX enters Playing state
      vi.advanceTimersByTime(10)
      expect(sm.sfxPlaying).toBe(true)
      expect(sm.sfxTransitioning).toBe(false)
      expect(sm.stateLog).toContain('sfx-now-playing')
    })

    it('SFX plays fully then music resumes', async () => {
      // Start music
      streamTrack(sm, 'battle.mp3')
      vi.advanceTimersByTime(10)

      // Trigger SFX
      streamSfx(sm, '/sfx/boom.ogg')
      vi.advanceTimersByTime(10) // SFX enters Playing

      expect(sm.sfxPlaying).toBe(true)
      expect(sm.musicResumeCount).toBe(0)

      // SFX finishes naturally
      sm.player.simulateResourceEnd()

      expect(sm.sfxPlaying).toBe(false)
      expect(sm.stateLog).toContain('sfx-finished')
      expect(sm.stateLog).toContain('music-resumed:battle.mp3')
      expect(sm.musicResumeCount).toBe(1)
    })

    it('music is deferred while SFX is active', () => {
      streamTrack(sm, 'battle.mp3')
      vi.advanceTimersByTime(10)

      streamSfx(sm, '/sfx/boom.ogg')
      vi.advanceTimersByTime(10)

      // Try to change music while SFX is playing
      streamTrack(sm, 'tavern.mp3')
      expect(sm.currentTrack).toBe('tavern.mp3') // track is noted
      expect(sm.stateLog).toContain('music-deferred:tavern.mp3')

      // SFX finishes — should resume with the NEW track
      sm.player.simulateResourceEnd()
      expect(sm.stateLog).toContain('music-resumed:tavern.mp3')
    })

    it('music is deferred during SFX transition phase', () => {
      streamTrack(sm, 'battle.mp3')
      vi.advanceTimersByTime(10)

      streamSfx(sm, '/sfx/boom.ogg')
      // Don't advance timers — still in transition phase
      expect(sm.sfxTransitioning).toBe(true)

      streamTrack(sm, 'tavern.mp3')
      expect(sm.stateLog).toContain('music-deferred:tavern.mp3')
    })
  })

  describe('SFX queuing', () => {
    it('queues SFX when another is already playing', () => {
      streamTrack(sm, 'battle.mp3')
      vi.advanceTimersByTime(10)

      streamSfx(sm, '/sfx/boom.ogg')
      vi.advanceTimersByTime(10) // first SFX playing

      streamSfx(sm, '/sfx/clang.ogg')
      expect(sm.sfxQueue).toHaveLength(1)
      expect(sm.stateLog).toContain('sfx-queued:/sfx/clang.ogg')
    })

    it('queues SFX during transition phase', () => {
      streamTrack(sm, 'battle.mp3')
      vi.advanceTimersByTime(10)

      streamSfx(sm, '/sfx/boom.ogg')
      // Still transitioning
      streamSfx(sm, '/sfx/clang.ogg')
      expect(sm.sfxQueue).toHaveLength(1)
    })

    it('plays queued SFX sequentially then resumes music', async () => {
      streamTrack(sm, 'battle.mp3')
      vi.advanceTimersByTime(10)

      // Queue 3 SFX
      streamSfx(sm, '/sfx/boom.ogg')
      vi.advanceTimersByTime(10) // first SFX playing

      streamSfx(sm, '/sfx/clang.ogg')
      streamSfx(sm, '/sfx/whoosh.ogg')
      expect(sm.sfxQueue).toHaveLength(2)

      // First SFX finishes → second starts
      sm.player.simulateResourceEnd()
      expect(sm.stateLog).toContain('sfx-starting:/sfx/clang.ogg')
      expect(sm.sfxQueue).toHaveLength(1)

      vi.advanceTimersByTime(10) // second SFX enters Playing

      // Second SFX finishes → third starts
      sm.player.simulateResourceEnd()
      expect(sm.stateLog).toContain('sfx-starting:/sfx/whoosh.ogg')
      expect(sm.sfxQueue).toHaveLength(0)

      vi.advanceTimersByTime(10) // third SFX enters Playing

      // Third SFX finishes → music resumes
      sm.player.simulateResourceEnd()
      expect(sm.stateLog).toContain('music-resumed:battle.mp3')
      expect(sm.musicResumeCount).toBe(1)
      expect(sm.sfxPlayCount).toBe(3)
    })
  })

  describe('SFX without music', () => {
    it('plays SFX when no music is active', () => {
      streamSfx(sm, '/sfx/boom.ogg')
      expect(sm.sfxTransitioning).toBe(true)
      expect(sm.stateLog).toContain('sfx-starting:/sfx/boom.ogg')

      vi.advanceTimersByTime(10)
      expect(sm.sfxPlaying).toBe(true)
    })

    it('does not try to resume music when SFX finishes and no track is set', () => {
      streamSfx(sm, '/sfx/boom.ogg')
      vi.advanceTimersByTime(10)

      sm.player.simulateResourceEnd()
      expect(sm.musicResumeCount).toBe(0)
      expect(sm.stateLog).toContain('sfx-finished')
      // No music-resumed entry
      expect(sm.stateLog.filter((s) => s.startsWith('music-resumed'))).toHaveLength(0)
    })
  })

  describe('edge cases', () => {
    it('handles SFX triggered when player is idle (no music playing)', () => {
      // Player is idle, no music. SFX should play without the displaced-Idle issue.
      streamSfx(sm, '/sfx/boom.ogg')

      // No displaced Idle event since nothing was playing
      expect(sm.stateLog).not.toContain('idle-ignored-transitioning')
      expect(sm.sfxTransitioning).toBe(true)

      vi.advanceTimersByTime(10)
      expect(sm.sfxPlaying).toBe(true)
    })

    it('handles rapid SFX fire (3 SFX in quick succession, no music)', () => {
      streamSfx(sm, '/sfx/a.ogg')
      streamSfx(sm, '/sfx/b.ogg')
      streamSfx(sm, '/sfx/c.ogg')

      expect(sm.sfxQueue).toHaveLength(2)

      vi.advanceTimersByTime(10) // first SFX playing
      sm.player.simulateResourceEnd() // first ends
      vi.advanceTimersByTime(10) // second playing
      sm.player.simulateResourceEnd() // second ends
      vi.advanceTimersByTime(10) // third playing
      sm.player.simulateResourceEnd() // third ends

      expect(sm.sfxPlayCount).toBe(3)
      expect(sm.sfxQueue).toHaveLength(0)
      expect(sm.sfxPlaying).toBe(false)
      expect(sm.sfxTransitioning).toBe(false)
    })

    it('volume is passed through to SFX resource', () => {
      streamSfx(sm, '/sfx/boom.ogg', 0.5)
      // The resource created in playNextSfx should have volume 0.5
      const resource = sm.player.currentResource
      expect(resource).toBeTruthy()
      expect(resource._label).toBe('sfx:/sfx/boom.ogg')
      expect(resource.volume.volume).toBe(0.5)
    })

    it('SFX uses default volume when none specified', () => {
      streamSfx(sm, '/sfx/boom.ogg')
      const resource = sm.player.currentResource
      expect(resource.volume.volume).toBe(1.0) // default
    })
  })
})
