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

    destroyed = false

    constructor() {
      super()
      // Expose the newest client so tests can inspect it after connect() nulls the module ref
      ;(globalThis as any).__mockClient = this
    }

    async login(_token: string): Promise<string> {
      // Test knob: __mockReadyDelay = ms to wait before emitting 'ready', or null to never fire
      const knob = (globalThis as any).__mockReadyDelay
      const delay = knob === null ? null : (knob ?? 10)
      if (delay !== null) {
        setTimeout(() => {
          if (!this.destroyed) this.emit('ready')
        }, delay)
      }
      return 'token'
    }

    destroy(): void {
      this.destroyed = true
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
    // Test knobs: __encAvailable / __encryptThrows / __decryptThrows simulate
    // a keychain the app can't access (e.g. after a reinstall changed its signature).
    isEncryptionAvailable: () => (globalThis as any).__encAvailable ?? false,
    encryptString: (s: string) => {
      if ((globalThis as any).__encryptThrows) throw new Error('keychain denied')
      return Buffer.from(s)
    },
    decryptString: (b: Buffer) => {
      if ((globalThis as any).__decryptThrows) throw new Error('Error while decrypting')
      return b.toString()
    },
  },
}))

vi.mock('./discord-audio', () => ({
  createMusicResource: (_path: string, _seek: number) => ({ metadata: { title: 'test' } }),
  createSfxResource: (_path: string, _vol: number) => ({ metadata: { title: 'sfx' } }),
}))

vi.mock('./store', () => {
  const data: Record<string, unknown> = {
    discordVolume: 1.0,
    musicFolder: '/tmp/music',
    sfxFolder: '/tmp/sfx',
    discordAutoConnect: false,
  }
  return {
    store: {
      get: (key: string, def: unknown) => data[key] ?? def,
      set: (key: string, value: unknown) => {
        data[key] = value
      },
      delete: (key: string) => {
        delete data[key]
      },
    },
  }
})

// ── Import after mocks ───────────────────────────────────────────────────────

import {
  clearToken,
  connect,
  destroyDiscord,
  disconnect,
  getGuilds,
  getState,
  getVoiceChannels,
  joinChannel,
  leaveChannel,
  loadToken,
  onStateChange,
  pauseStream,
  resumeStream,
  stopStream,
  streamTrack,
} from './discord'
import { store } from './store'

// ── Tests ─────────────────────────────────────────────────────────────────────

function getMockPlayer(): any {
  return (globalThis as any).__mockPlayer
}

describe('Discord lifecycle', () => {
  const stateHistory: ReturnType<typeof getState>[] = []
  let unsubState: () => void

  beforeEach(() => {
    stateHistory.length = 0
    clearToken() // the store mock now persists tokens between tests
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

    // Regression: 3.0.0 loaded three engines at startup, the gateway handshake
    // slipped past the old 15s deadline, and healthy logins were rejected.
    it('keeps waiting past 15s when the gateway handshake is slow', async () => {
      vi.useFakeTimers()
      try {
        ;(globalThis as any).__mockReadyDelay = null // 'ready' never arrives on its own
        let settled = false
        const pending = connect('fake-token').finally(() => {
          settled = true
        })
        pending.catch(() => {}) // no unhandled rejection if the assertion below fails

        await vi.advanceTimersByTimeAsync(20_000)

        expect(settled).toBe(false)
        expect(getState().status).toBe('connecting')

        // The handshake finally completes — connect must still resolve
        ;(globalThis as any).__mockClient.emit('ready')
        await pending
        expect(getState().status).toBe('ready')
      } finally {
        ;(globalThis as any).__mockReadyDelay = 10
        vi.useRealTimers()
      }
    })

    it('destroys the client when the handshake times out so a retry starts clean', async () => {
      vi.useFakeTimers()
      try {
        ;(globalThis as any).__mockReadyDelay = null
        const first = connect('fake-token')
        first.catch(() => {}) // no unhandled rejection before we await it

        await vi.advanceTimersByTimeAsync(46_000)

        await expect(first).rejects.toThrow('Connection timed out')
        const timedOut = (globalThis as any).__mockClient
        expect(timedOut.destroyed).toBe(true)
        expect(getState()).toMatchObject({ status: 'error', error: 'Connection timed out' })

        // Retry gets a fresh client and succeeds
        ;(globalThis as any).__mockReadyDelay = 10
        const retry = connect('fake-token')
        await vi.advanceTimersByTimeAsync(50)
        await expect(retry).resolves.toBeUndefined()

        expect((globalThis as any).__mockClient).not.toBe(timedOut)
        expect((globalThis as any).__mockClient.destroyed).toBe(false)
        expect(getState().status).toBe('ready')
      } finally {
        ;(globalThis as any).__mockReadyDelay = 10
        vi.useRealTimers()
      }
    })
  })

  describe('token persistence', () => {
    afterEach(() => {
      ;(globalThis as any).__encAvailable = false
      ;(globalThis as any).__encryptThrows = false
      ;(globalThis as any).__decryptThrows = false
      clearToken()
    })

    // Regression: 3.0.1 users on a fresh install got a keychain that refused
    // writes after the app's signature changed. The throw happened inside the
    // 'ready' handler, so connect() never resolved and the button hung silent.
    it('connects when the keychain refuses to save the token', async () => {
      ;(globalThis as any).__encAvailable = true
      ;(globalThis as any).__encryptThrows = true

      await expect(connect('fake-token')).resolves.toBeUndefined()
      expect(getState()).toMatchObject({ status: 'ready', error: null })
    })

    it('still saves the token when the keychain works', async () => {
      ;(globalThis as any).__encAvailable = true

      await connect('fake-token')

      expect(loadToken()).toBe('fake-token')
    })

    it('returns empty for stored ciphertext this build cannot decrypt', () => {
      ;(globalThis as any).__encAvailable = true
      ;(globalThis as any).__decryptThrows = true
      // Old encrypted value, base64 — not a token (no dots)
      store.set('discordToken', 'ZmFrZS1jaXBoZXJ0ZXh0')

      expect(loadToken()).toBe('')
    })

    it('returns empty when encryption is gone and only ciphertext is stored', () => {
      ;(globalThis as any).__encAvailable = true
      store.set('discordToken', Buffer.from('ciphertext').toString('base64'))

      ;(globalThis as any).__encAvailable = false

      expect(loadToken()).toBe('')
    })

    it('still reads a plaintext token saved by an older build', () => {
      ;(globalThis as any).__encAvailable = true
      ;(globalThis as any).__decryptThrows = true
      store.set('discordToken', 'MTIz.GAbCdE.abcDEF123')

      expect(loadToken()).toBe('MTIz.GAbCdE.abcDEF123')
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
