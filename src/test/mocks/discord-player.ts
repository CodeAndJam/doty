/**
 * Mock for @discordjs/voice AudioPlayer state machine.
 * Simulates the exact event sequence that discord.js produces when
 * player.play() is called while another resource is active.
 */

import { EventEmitter } from 'node:events'
import { vi } from 'vitest'

export const AudioPlayerStatus = {
  Idle: 'idle',
  Buffering: 'buffering',
  Playing: 'playing',
  AutoPaused: 'autopaused',
  Paused: 'paused',
} as const

export const VoiceConnectionStatus = {
  Ready: 'ready',
  Signalling: 'signalling',
  Connecting: 'connecting',
  Disconnected: 'disconnected',
  Destroyed: 'destroyed',
} as const

export const StreamType = { Raw: 'raw' } as const

export interface MockAudioResource {
  volume: { setVolume: ReturnType<typeof vi.fn>; volume: number } | null
  playbackDuration: number
  _label: string
}

export class MockAudioPlayer extends EventEmitter {
  state: { status: string } = { status: AudioPlayerStatus.Idle }
  private _currentResource: MockAudioResource | null = null

  /**
   * Simulate player.play(resource).
   *
   * CRITICAL: This replicates the real discord.js behavior:
   * 1. If a resource is already playing, the player transitions to Idle FIRST
   *    (the old resource is displaced)
   * 2. Then it transitions to Buffering → Playing for the new resource
   *
   * The `idleDelay` and `playingDelay` params control timing to test race conditions.
   */
  play(resource: MockAudioResource, { idleDelay = 0, playingDelay = 5 } = {}): void {
    const wasPlaying = this.state.status === AudioPlayerStatus.Playing

    if (wasPlaying) {
      // Displaced resource causes Idle event — this is the race condition trigger
      if (idleDelay === 0) {
        this.state = { status: AudioPlayerStatus.Idle }
        this.emit(AudioPlayerStatus.Idle)
      } else {
        setTimeout(() => {
          this.state = { status: AudioPlayerStatus.Idle }
          this.emit(AudioPlayerStatus.Idle)
        }, idleDelay)
      }
    }

    this._currentResource = resource

    // New resource starts playing after a short delay
    setTimeout(() => {
      if (this._currentResource === resource) {
        this.state = { status: AudioPlayerStatus.Playing }
        this.emit(AudioPlayerStatus.Playing)
      }
    }, playingDelay)
  }

  stop(_force?: boolean): void {
    this._currentResource = null
    this.state = { status: AudioPlayerStatus.Idle }
    this.emit(AudioPlayerStatus.Idle)
  }

  pause(_interpolateSilence?: boolean): void {
    this.state = { status: AudioPlayerStatus.Paused }
    this.emit(AudioPlayerStatus.Paused)
  }

  unpause(): void {
    this.state = { status: AudioPlayerStatus.Playing }
    this.emit(AudioPlayerStatus.Playing)
  }

  get currentResource(): MockAudioResource | null {
    return this._currentResource
  }

  /**
   * Simulate the current resource finishing naturally (e.g. SFX ends).
   * This fires Idle, which is the "resource finished" signal.
   */
  simulateResourceEnd(): void {
    this._currentResource = null
    this.state = { status: AudioPlayerStatus.Idle }
    this.emit(AudioPlayerStatus.Idle)
  }
}

export function createMockResource(label: string, volume = 1.0): MockAudioResource {
  return {
    volume: { setVolume: vi.fn(), volume },
    playbackDuration: 0,
    _label: label,
  }
}
