/**
 * Discord bot client — manages connection, voice channels, and audio streaming.
 * Runs in the Electron main process.
 */
import {
  Client,
  GatewayIntentBits,
  ChannelType,
  type VoiceBasedChannel,
  type Guild,
} from 'discord.js'
import {
  joinVoiceChannel,
  createAudioPlayer,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  type VoiceConnection,
  type AudioPlayer,
} from '@discordjs/voice'
import { createMusicResource } from './discord-audio'
import { store } from './store'
import { safeStorage } from 'electron'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DiscordGuild {
  id: string
  name: string
  icon: string | null
}

export interface DiscordVoiceChannel {
  id: string
  name: string
  guildId: string
}

export type DiscordStatus =
  | 'disconnected'
  | 'connecting'
  | 'ready'
  | 'error'

export type DiscordVoiceStatus =
  | 'idle'
  | 'joining'
  | 'connected'
  | 'playing'
  | 'error'

export interface DiscordState {
  status: DiscordStatus
  voiceStatus: DiscordVoiceStatus
  currentGuildId: string | null
  currentChannelId: string | null
  error: string | null
}

type StateListener = (state: DiscordState) => void

// ── Module state ──────────────────────────────────────────────────────────────

let client: Client | null = null
let player: AudioPlayer | null = null
let connection: VoiceConnection | null = null
let currentTrack: string | null = null
let discordVolume = 1.0
let stateListeners: StateListener[] = []

let state: DiscordState = {
  status: 'disconnected',
  voiceStatus: 'idle',
  currentGuildId: null,
  currentChannelId: null,
  error: null,
}

function setState(patch: Partial<DiscordState>) {
  state = { ...state, ...patch }
  for (const fn of stateListeners) fn(state)
}

export function onStateChange(fn: StateListener): () => void {
  stateListeners.push(fn)
  return () => { stateListeners = stateListeners.filter((l) => l !== fn) }
}

export function getState(): DiscordState {
  return state
}

// ── Token management (encrypted) ──────────────────────────────────────────────

export function saveToken(token: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(token)
    store.set('discordToken', encrypted.toString('base64'))
  } else {
    // Fallback: store as-is (less secure, but functional)
    store.set('discordToken', token)
  }
}

export function loadToken(): string {
  const raw = store.get('discordToken', '') as string
  if (!raw) return ''
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const buf = Buffer.from(raw, 'base64')
      return safeStorage.decryptString(buf)
    } catch {
      // Might be stored unencrypted from a previous run
      return raw
    }
  }
  return raw
}

export function clearToken(): void {
  store.set('discordToken', '')
}

// ── Volume ────────────────────────────────────────────────────────────────────

export function setDiscordVolume(vol: number): void {
  discordVolume = Math.max(0, Math.min(1, vol))
  store.set('discordVolume', discordVolume)
}

export function getDiscordVolume(): number {
  return discordVolume
}

// ── Connect / Disconnect ──────────────────────────────────────────────────────

export async function connect(token?: string): Promise<void> {
  if (client) {
    await disconnect()
  }

  const botToken = token || loadToken()
  if (!botToken) {
    setState({ status: 'error', error: 'No bot token configured' })
    throw new Error('No bot token configured')
  }

  setState({ status: 'connecting', error: null })

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
    ],
  })

  // Load persisted volume
  discordVolume = (store.get('discordVolume', 1.0) as number) ?? 1.0

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Connection timed out'))
      setState({ status: 'error', error: 'Connection timed out' })
    }, 15_000)

    client!.once('ready', () => {
      clearTimeout(timeout)
      console.log(`[discord] Bot connected as ${client!.user?.tag}`)
      if (token) saveToken(token) // persist on successful connect
      setState({ status: 'ready', error: null })
      resolve()
    })

    client!.once('error', (err) => {
      clearTimeout(timeout)
      console.error('[discord] Client error:', err.message)
      setState({ status: 'error', error: err.message })
      reject(err)
    })

    client!.login(botToken).catch((err) => {
      clearTimeout(timeout)
      const msg = err.message?.includes('TOKEN_INVALID')
        ? 'Invalid bot token'
        : err.message || 'Login failed'
      console.error('[discord] Login failed:', msg)
      setState({ status: 'error', error: msg })
      reject(new Error(msg))
    })
  })
}

export async function disconnect(): Promise<void> {
  leaveChannel()
  if (client) {
    client.destroy()
    client = null
  }
  setState({
    status: 'disconnected',
    voiceStatus: 'idle',
    currentGuildId: null,
    currentChannelId: null,
    error: null,
  })
  console.log('[discord] Disconnected')
}

// ── Guild / Channel listing ───────────────────────────────────────────────────

export function getGuilds(): DiscordGuild[] {
  if (!client) return []
  return client.guilds.cache.map((g: Guild) => ({
    id: g.id,
    name: g.name,
    icon: g.iconURL({ size: 32 }),
  }))
}

export function getVoiceChannels(guildId: string): DiscordVoiceChannel[] {
  if (!client) return []
  const guild = client.guilds.cache.get(guildId)
  if (!guild) return []
  return guild.channels.cache
    .filter((ch) => ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice)
    .map((ch) => ({
      id: ch.id,
      name: ch.name,
      guildId: guild.id,
    }))
}

// ── Voice channel join / leave ────────────────────────────────────────────────

export async function joinChannel(guildId: string, channelId: string): Promise<void> {
  if (!client) throw new Error('Bot not connected')

  const guild = client.guilds.cache.get(guildId)
  if (!guild) throw new Error(`Guild ${guildId} not found`)

  const channel = guild.channels.cache.get(channelId) as VoiceBasedChannel | undefined
  if (!channel) throw new Error(`Channel ${channelId} not found`)

  setState({ voiceStatus: 'joining', error: null })

  // Clean up existing connection
  if (connection) {
    connection.destroy()
    connection = null
  }

  // Create audio player
  if (!player) {
    player = createAudioPlayer()

    player.on(AudioPlayerStatus.Playing, () => {
      setState({ voiceStatus: 'playing' })
    })

    player.on(AudioPlayerStatus.Idle, () => {
      setState({ voiceStatus: 'connected' })
    })

    player.on('error', (err) => {
      console.error('[discord] Player error:', err.message)
      setState({ voiceStatus: 'error', error: `Player: ${err.message}` })
    })
  }

  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
  })

  // Subscribe the player to the connection
  connection.subscribe(player)

  // Handle disconnects and reconnects
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      // Try to reconnect within 5 seconds
      await Promise.race([
        entersState(connection!, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection!, VoiceConnectionStatus.Connecting, 5_000),
      ])
      // Reconnecting...
    } catch {
      // Gave up — destroy connection
      connection?.destroy()
      connection = null
      setState({
        voiceStatus: 'idle',
        currentGuildId: null,
        currentChannelId: null,
      })
    }
  })

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    connection = null
    setState({
      voiceStatus: 'idle',
      currentGuildId: null,
      currentChannelId: null,
    })
  })

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000)
    setState({
      voiceStatus: 'connected',
      currentGuildId: guildId,
      currentChannelId: channelId,
      error: null,
    })
    console.log(`[discord] Joined voice channel: ${channel.name}`)

    // If a track was already playing locally, start streaming it
    if (currentTrack) {
      streamTrack(currentTrack)
    }
  } catch (err) {
    connection?.destroy()
    connection = null
    const msg = err instanceof Error ? err.message : 'Failed to join channel'
    setState({ voiceStatus: 'error', error: msg })
    throw new Error(msg)
  }
}

export function leaveChannel(): void {
  if (player) {
    player.stop(true)
  }
  if (connection) {
    connection.destroy()
    connection = null
  }
  player = null
  setState({
    voiceStatus: 'idle',
    currentGuildId: null,
    currentChannelId: null,
  })
}

// ── Audio streaming ───────────────────────────────────────────────────────────

/**
 * Stream a track to the Discord voice channel.
 * Called by the renderer via IPC whenever a track starts playing locally.
 */
export function streamTrack(filename: string): void {
  currentTrack = filename

  // Only stream if we're in a voice channel
  if (!player || !connection) return

  const musicFolder = store.get('musicFolder', '') as string
  if (!musicFolder) return

  try {
    const resource = createMusicResource(musicFolder, filename, discordVolume)
    player.play(resource)
    console.log(`[discord] Streaming: ${filename}`)
  } catch (err) {
    console.error('[discord] Stream error:', err)
  }
}

/**
 * Stop streaming audio to Discord (e.g. when local playback stops).
 */
export function stopStream(): void {
  currentTrack = null
  if (player) {
    player.stop(true)
  }
}

/**
 * Clean up everything — call on app quit.
 */
export function destroyDiscord(): void {
  leaveChannel()
  if (client) {
    client.destroy()
    client = null
  }
  stateListeners = []
}
