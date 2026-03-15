/**
 * Integration tests for Discord connect/disconnect/stream lifecycle.
 *
 * These tests mock discord.js Client, @discordjs/voice, and electron
 * to isolate the state machine logic in discord.ts without requiring
 * a real Discord bot token or network access.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Shared mock instances (set by mock factories) ─────────────────────────────

let _mockPlayer: any
let _mockConnection: any

// ── Mock modules (factories are hoisted — no external refs allowed) ───────────

vi.mock('discord.js', () => {
  // discord.js Collection extends Map with .map() and .filter() — simulate that
  class Collection extends Map<any, any> {
    map(fn: (value: any, key: any, map: Map<any, any>) => any): any[] {
      const result: any[] = []
      for (const [k, v] of this) {
        result.push(fn(v, k, this))
      }
      return result
    }
    filter(fn: (value: any, key: any, map: Map<any, any>) => boolean): Collection {
      const result = new Collection()
      for (const [k, v] of this) {
        if (fn(v, k, this)) result.set(k, v)
      }
      return result
    }
  }

  const { EventEmitter } = require('node:events')

  class MockClient extends EventEmitter {
    user = { tag: 'TestBot#1234' }
    guilds = {
      cache: new Collection([
        [
          'guild-1',
          {
            id: 'guild-1',
            name: 'Test Guild',
            iconURL: () => null,
            channels: {
              cache: new Collection([
                ['vc-1', { id: 'vc-1', name: 'General', type: 2, guildId: 'guild-1' }],
                ['vc-2', { id: 'vc-2', name: 'Music', type: 2, guildId: 'guild-1' }],
                ['text-1', { id: 'text-1', name: 'chat', type: 0, guildId: 'guild-1' }],
              ]),
            },
          },
        ],
      ]),
    }

    async login(_token: string): Promise<string> {
      setTimeout(() => {
        this.emit('ready')
      }, 10)
      return 'token'
    }

    destroy(): void {
      this.removeAllListeners()
    }
  }

  return {
    Client: MockClient,
    GatewayIntentBits: { Guilds: 1, GuildVoiceStates: 128 },
    ChannelType: { GuildVoice: 2, GuildStageVoice: 13 },
  }
})

vi.mock('@discordjs/voice', () => {
  const { EventEmitter } = require('node:events')

  const AudioPlayerStatus = {
    Idle: 'idle',
    Buffering: 'buffering',
    Playing: 'playing',
    AutoPaused: 'autopaused',
    Paused: 'paused',
  }

  const VoiceConnectionStatus = {
    Signalling: 'signalling',
    Connecting: 'connecting',
    Ready: 'ready',
    Disconnected: 'disconnected',
    Destroyed: 'destroyed',
  }

  class MockAudioPlayer extends EventEmitter {
    state = { status: 'idle' }

    play(_resource: any): void {
      this.state = { status: 'buffering' }
      setTimeout(() => {
        this.state = { status: 'playing' }
        this.emit('stateChange', { status: 'buffering' }, { status: 'playing' })
      }, 5)
    }

    pause(): boolean {
      this.state = { status: 'paused' }
      this.emit('stateChange', { status: 'playing' }, { status: 'paused' })
      return true
    }

    unpause(): boolean {
      this.state = { status: 'playing' }
      this.emit('stateChange', { status: 'paused' }, { status: 'playing' })
      return true
    }

    stop(_force?: boolean): boolean {
      this.state = { status: 'idle' }
      this.emit('stateChange', { status: 'playing' }, { status: 'idle' })
      return true
    }
  }

  class MockVoiceConnection extends EventEmitter {
    state = { status: 'ready' }
    joinConfig = { guildId: 'guild-1', channelId: 'vc-1' }

    subscribe(_player: any): { unsubscribe: () => void } {
      return { unsubscribe: () => {} }
    }

    destroy(): void {
      this.state = { status: 'destroyed' }
      this.removeAllListeners()
    }
  }
  // Expose mock instances via a global so tests can access them
  ;(globalThis as any).__mockPlayer = null
  ;(globalThis as any).__mockConnection = null

  return {
    AudioPlayerStatus,
    VoiceConnectionStatus,
    createAudioPlayer: () => {
      const p = new MockAudioPlayer()
      ;(globalThis as any).__mockPlayer = p
      return p
    },
    joinVoiceChannel: (_opts: any) => {
      const c = new MockVoiceConnection()
      ;(globalThis as any).__mockConnection = c
      setTimeout(() => {
        c.state = { status: 'ready' }
        c.emit('stateChange', { status: 'signalling' }, { status: 'ready' })
      }, 5)
      return c
    },
    entersState: async (target: any, _status: string, _timeout: number) => target,
  }
})

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}))

vi.mock('./discord-audio', () => ({
  createMusicResource: (_path: string, _seek: number) => ({ metadata: { title: 'test' } }),
  createSfxResource: (_path: string, _vol: number) => ({ metadata: { title: 'sfx' } }),
}))

vi.mock('./store', () => ({
  store: {
    get: (key: string, def: unknown) => {
      const vals: Record<string, unknown> = {
        discordVolume: 1.0,
        musicFolder: '/tmp/music',
        sfxFolder: '/tmp/sfx',
        discordAutoConnect: false,
      }
      return vals[key] ?? def
    },
    set: () => {},
    delete: () => {},
  },
}))

// ── Import after mocks ───────────────────────────────────────────────────────

import {
  connect,
  destroyDiscord,
  disconnect,
  getGuilds,
  getState,
  getVoiceChannels,
  joinChannel,
  leaveChannel,
  onStateChange,
  pauseStream,
  resumeStream,
  stopStream,
  streamTrack,
} from './discord'

// ── Tests ─────────────────────────────────────────────────────────────────────

function getMockPlayer(): any {
  return (globalThis as any).__mockPlayer
}

describe('Discord lifecycle', () => {
  const stateHistory: ReturnType<typeof getState>[] = []
  let unsubState: () => void

  beforeEach(() => {
    stateHistory.length = 0
    unsubState = onStateChange((s) => {
      stateHistory.push({ ...s })
    })
  })

  afterEach(async () => {
    unsubState()
    destroyDiscord()
    // Allow pending timers to flush
    await new Promise((r) => {
      setTimeout(r, 50)
    })
  })

  describe('connect / disconnect', () => {
    it('starts in disconnected state', () => {
      const s = getState()
      expect(s.status).toBe('disconnected')
      expect(s.voiceStatus).toBe('idle')
      expect(s.currentGuildId).toBeNull()
      expect(s.currentChannelId).toBeNull()
      expect(s.error).toBeNull()
    })

    it('transitions to connecting then ready on successful connect', async () => {
      await connect('fake-token')

      const s = getState()
      expect(s.status).toBe('ready')
      expect(s.error).toBeNull()

      // Should have gone through connecting -> ready
      const statuses = stateHistory.map((h) => h.status)
      expect(statuses).toContain('connecting')
      expect(statuses).toContain('ready')
    })

    it('transitions back to disconnected on disconnect', async () => {
      await connect('fake-token')
      await disconnect()

      const s = getState()
      expect(s.status).toBe('disconnected')
      expect(s.voiceStatus).toBe('idle')
      expect(s.currentGuildId).toBeNull()
      expect(s.currentChannelId).toBeNull()
    })

    it('throws on connect without token', async () => {
      // loadToken returns '' when no token saved and no token passed
      await expect(connect('')).rejects.toThrow()
      expect(getState().status).toBe('error')
    })

    it('can reconnect after disconnect', async () => {
      await connect('fake-token')
      await disconnect()
      expect(getState().status).toBe('disconnected')

      await connect('fake-token-2')
      expect(getState().status).toBe('ready')
    })
  })

  describe('guilds and channels', () => {
    it('returns guilds after connecting', async () => {
      await connect('fake-token')
      const guilds = getGuilds()
      expect(guilds).toHaveLength(1)
      expect(guilds[0].id).toBe('guild-1')
      expect(guilds[0].name).toBe('Test Guild')
    })

    it('returns empty guilds when disconnected', () => {
      const guilds = getGuilds()
      expect(guilds).toEqual([])
    })

    it('returns voice channels for a guild', async () => {
      await connect('fake-token')
      const channels = getVoiceChannels('guild-1')
      // Should only include voice channels (type 2), not text channels
      expect(channels).toHaveLength(2)
      expect(channels.map((c) => c.name)).toContain('General')
      expect(channels.map((c) => c.name)).toContain('Music')
    })

    it('returns empty channels for unknown guild', async () => {
      await connect('fake-token')
      const channels = getVoiceChannels('unknown-guild')
      expect(channels).toEqual([])
    })
  })

  describe('voice channel join / leave', () => {
    it('joins a voice channel and updates state', async () => {
      await connect('fake-token')
      await joinChannel('guild-1', 'vc-1')

      // Allow async state transitions
      await new Promise((r) => {
        setTimeout(r, 50)
      })

      const s = getState()
      expect(s.currentGuildId).toBe('guild-1')
      expect(s.currentChannelId).toBe('vc-1')
    })

    it('leaves a voice channel and resets state', async () => {
      await connect('fake-token')
      await joinChannel('guild-1', 'vc-1')
      await new Promise((r) => {
        setTimeout(r, 50)
      })

      leaveChannel()

      const s = getState()
      expect(s.voiceStatus).toBe('idle')
      expect(s.currentGuildId).toBeNull()
      expect(s.currentChannelId).toBeNull()
    })
  })

  describe('stream lifecycle', () => {
    it('streamTrack does nothing without a voice connection', async () => {
      await connect('fake-token')
      // Don't join a channel — no player/connection
      streamTrack('test.mp3')
      // Should not throw, just silently skip
      expect(getState().voiceStatus).toBe('idle')
    })

    it('stopStream resets track state', async () => {
      await connect('fake-token')
      await joinChannel('guild-1', 'vc-1')
      await new Promise((r) => {
        setTimeout(r, 50)
      })

      streamTrack('test.mp3')
      stopStream()

      // Player should be stopped, no current track
      expect(getMockPlayer().state.status).toBe('idle')
    })

    it('pauseStream and resumeStream toggle player state', async () => {
      await connect('fake-token')
      await joinChannel('guild-1', 'vc-1')
      await new Promise((r) => {
        setTimeout(r, 50)
      })

      streamTrack('test.mp3')
      await new Promise((r) => {
        setTimeout(r, 20)
      })

      pauseStream()
      expect(getMockPlayer().state.status).toBe('paused')

      resumeStream()
      expect(getMockPlayer().state.status).toBe('playing')
    })
  })

  describe('state listener', () => {
    it('notifies listeners on state changes', async () => {
      const states: string[] = []
      const unsub = onStateChange((s) => {
        states.push(s.status)
      })

      await connect('fake-token')
      await disconnect()

      unsub()

      expect(states).toContain('connecting')
      expect(states).toContain('ready')
      expect(states).toContain('disconnected')
    })

    it('unsubscribe stops notifications', async () => {
      const states: string[] = []
      const unsub = onStateChange((s) => {
        states.push(s.status)
      })

      await connect('fake-token')
      unsub()

      const countAfterUnsub = states.length
      await disconnect()

      // Should not have received the disconnect notification
      expect(states.length).toBe(countAfterUnsub)
    })
  })

  describe('destroyDiscord', () => {
    it('cleans up everything', async () => {
      await connect('fake-token')
      await joinChannel('guild-1', 'vc-1')
      await new Promise((r) => {
        setTimeout(r, 50)
      })

      destroyDiscord()

      const s = getState()
      expect(s.voiceStatus).toBe('idle')
      expect(s.currentGuildId).toBeNull()
    })
  })
})
