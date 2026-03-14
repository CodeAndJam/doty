/**
 * Discord bot client — manages connection, voice channels, and audio streaming.
 * Runs in the Electron main process.
 */

import {
  type AudioPlayer,
  AudioPlayerStatus,
  type AudioResource,
  createAudioPlayer,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice'
import { ChannelType, Client, GatewayIntentBits, type Guild, type VoiceBasedChannel } from 'discord.js'
import { safeStorage } from 'electron'
import { createMusicResource, createSfxResource } from './discord-audio'
import { store } from './store'

// ── Verbose logging ───────────────────────────────────────────────────────────

let verbose = true

function log(msg: string): void {
  console.log(`[discord] ${msg}`)
}

function vlog(msg: string): void {
  if (verbose) console.log(`[discord:v] ${msg}`)
}

/** Enable or disable verbose Discord logging at runtime */
export function setDiscordVerbose(enabled: boolean): void {
  verbose = enabled
  log(`Verbose logging ${enabled ? 'enabled' : 'disabled'}`)
}

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

export type DiscordStatus = 'disconnected' | 'connecting' | 'ready' | 'error'

export type DiscordVoiceStatus = 'idle' | 'joining' | 'connected' | 'playing' | 'error'

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
let currentResource: AudioResource | null = null
let discordVolume = 1.0
let stateListeners: StateListener[] = []

/**
 * SFX interrupt state.
 *
 * When an SFX plays it temporarily takes over the AudioPlayer.
 * `sfxPlaying` is true while an SFX resource is the active resource.
 * `sfxTransitioning` is true between calling player.play(sfx) and the
 * player entering the Playing state — this prevents the Idle event
 * (fired when the *previous* resource is displaced) from being
 * misinterpreted as the SFX finishing.
 */
let sfxPlaying = false
let sfxTransitioning = false
let sfxQueue: { path: string; volume: number }[] = []

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
  return () => {
    stateListeners = stateListeners.filter((l) => l !== fn)
  }
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
  // Apply to the live stream immediately (only when music is active)
  if (!sfxPlaying && !sfxTransitioning) {
    currentResource?.volume?.setVolume(discordVolume)
  }
}

export function getDiscordVolume(): number {
  return discordVolume
}

// ── Auto-connect ──────────────────────────────────────────────────────────────

export function setAutoConnect(enabled: boolean): void {
  store.set('discordAutoConnect', enabled)
  log(`Auto-connect ${enabled ? 'enabled' : 'disabled'}`)
}

export function getAutoConnect(): boolean {
  return (store.get('discordAutoConnect', false) as boolean) ?? false
}

/**
 * Try to reconnect to the last voice channel on startup.
 * Called once from main.ts after the app is ready.
 * Silently does nothing if auto-connect is off, no token, or last channel is missing.
 */
export async function tryAutoConnect(): Promise<void> {
  if (!getAutoConnect()) return
  const token = loadToken()
  if (!token) return

  const guildId = store.get('discordLastGuildId', '') as string
  const channelId = store.get('discordLastChannelId', '') as string
  if (!guildId || !channelId) {
    log('Auto-connect: no last channel saved')
    return
  }

  log(`Auto-connect: connecting to guild=${guildId} channel=${channelId}`)
  try {
    await connect()
    await joinChannel(guildId, channelId)
    log('Auto-connect: success')
  } catch (err) {
    log(`Auto-connect: failed — ${err instanceof Error ? err.message : err}`)
  }
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
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
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
      const msg = err.message?.includes('TOKEN_INVALID') ? 'Invalid bot token' : err.message || 'Login failed'
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
      vlog(`EVENT Playing | sfxTransitioning=${sfxTransitioning} sfxPlaying=${sfxPlaying}`)
      if (sfxTransitioning) {
        sfxTransitioning = false
        sfxPlaying = true
        log('SFX now playing')
      }
      setState({ voiceStatus: 'playing' })
    })

    player.on(AudioPlayerStatus.Idle, () => {
      vlog(`EVENT Idle | sfxTransitioning=${sfxTransitioning} sfxPlaying=${sfxPlaying} queue=${sfxQueue.length}`)

      if (sfxTransitioning) {
        vlog('Ignoring Idle during SFX transition (displaced resource)')
        return
      }

      if (sfxPlaying) {
        sfxPlaying = false
        log(`SFX finished, queue=${sfxQueue.length}`)
        if (sfxQueue.length > 0) {
          const next = sfxQueue.shift()!
          playNextSfx(next.path, next.volume)
        } else {
          resumeMusicAfterSfx()
        }
        return
      }

      vlog('Player idle (normal)')
      setState({ voiceStatus: 'connected' })
    })

    player.on(AudioPlayerStatus.Buffering, () => {
      vlog(`EVENT Buffering | sfxTransitioning=${sfxTransitioning} sfxPlaying=${sfxPlaying}`)
    })

    player.on(AudioPlayerStatus.AutoPaused, () => {
      vlog(`EVENT AutoPaused | sfxTransitioning=${sfxTransitioning} sfxPlaying=${sfxPlaying}`)
    })

    player.on('error', (err) => {
      log(`Player error: ${err.message}`)
      vlog(`Error detail | sfxTransitioning=${sfxTransitioning} sfxPlaying=${sfxPlaying}`)
      if (sfxPlaying || sfxTransitioning) {
        sfxPlaying = false
        sfxTransitioning = false
        sfxQueue = []
        resumeMusicAfterSfx()
      }
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
    // Persist for auto-connect on next launch
    store.set('discordLastGuildId', guildId)
    store.set('discordLastChannelId', channelId)
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
  sfxPlaying = false
  sfxTransitioning = false
  sfxQueue = []
  currentResource = null
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
 * Stream a music track to the Discord voice channel.
 * @param seekSeconds — start playback at this offset (0 = beginning)
 */
export function streamTrack(filename: string, seekSeconds = 0): void {
  currentTrack = filename
  vlog(
    `streamTrack: ${filename}, seek=${seekSeconds}, player=${!!player}, conn=${!!connection}, sfxPlaying=${sfxPlaying}, sfxTransitioning=${sfxTransitioning}`,
  )

  if (!player || !connection) {
    vlog('streamTrack: no player or connection, skipping')
    return
  }

  // Don't interrupt an active SFX — the music will resume when SFX finishes
  if (sfxPlaying || sfxTransitioning) {
    log(`Music track noted (SFX active): ${filename}`)
    return
  }

  const musicFolder = store.get('musicFolder', '') as string
  if (!musicFolder) {
    vlog('streamTrack: no musicFolder configured')
    return
  }

  try {
    const resource = createMusicResource(musicFolder, filename, discordVolume, seekSeconds)
    currentResource = resource
    player.play(resource)
    log(`Streaming: ${filename}${seekSeconds > 0 ? ` (seek ${seekSeconds.toFixed(1)}s)` : ''}`)
  } catch (err) {
    log(`Stream error: ${err}`)
  }
}

/**
 * Play an SFX directly through the player, interrupting music temporarily.
 * Sets the transition guard so the Idle event from displacing the old
 * resource is ignored.
 */
function playNextSfx(absolutePath: string, volume: number): void {
  vlog(`playNextSfx: ${absolutePath.split('/').pop()}, vol=${volume}, player=${!!player}, conn=${!!connection}`)
  if (!player || !connection) {
    vlog('playNextSfx: no player or connection')
    return
  }

  try {
    const resource = createSfxResource(absolutePath, volume)
    vlog('SFX resource created, setting sfxTransitioning=true')
    // Set transition guard BEFORE calling play() — the Idle event from
    // the displaced resource will fire synchronously or on next tick.
    sfxTransitioning = true
    sfxPlaying = false
    player.play(resource)
    log(`SFX starting: ${absolutePath.split('/').pop()} (vol=${volume.toFixed(2)})`)
  } catch (err) {
    log(`SFX play error: ${err}`)
    sfxTransitioning = false
    sfxPlaying = false
    resumeMusicAfterSfx()
  }
}

/**
 * Resume music streaming after SFX finishes.
 * Restarts the current track from the beginning (seek position is lost,
 * but for background music in a D&D session this is acceptable).
 */
function resumeMusicAfterSfx(): void {
  vlog(`resumeMusicAfterSfx: currentTrack=${currentTrack}, player=${!!player}, conn=${!!connection}`)
  if (!currentTrack || !player || !connection) {
    vlog('resumeMusicAfterSfx: nothing to resume')
    return
  }

  const musicFolder = store.get('musicFolder', '') as string
  if (!musicFolder) {
    vlog('resumeMusicAfterSfx: no musicFolder')
    return
  }

  try {
    const resource = createMusicResource(musicFolder, currentTrack, discordVolume, 0)
    currentResource = resource
    player.play(resource)
    log(`Music resumed: ${currentTrack}`)
  } catch (err) {
    log(`Failed to resume music: ${err}`)
  }
}

/**
 * Stream an SFX to Discord, temporarily interrupting music.
 * Music resumes automatically when the SFX finishes.
 * @param absolutePath — absolute path to the SFX file
 * @param volume — SFX volume 0..1 (defaults to current Discord volume)
 */
export function streamSfx(absolutePath: string, volume?: number): void {
  const fname = absolutePath.split('/').pop()
  log(
    `streamSfx: ${fname}, player=${!!player}, conn=${!!connection}, sfxPlaying=${sfxPlaying}, sfxTransitioning=${sfxTransitioning}`,
  )
  if (!player || !connection) {
    vlog('streamSfx: no player or connection — is the bot in a voice channel?')
    return
  }

  const vol = volume ?? discordVolume

  if (sfxPlaying || sfxTransitioning) {
    sfxQueue.push({ path: absolutePath, volume: vol })
    log(`SFX queued: ${fname} (${sfxQueue.length} in queue)`)
    return
  }

  playNextSfx(absolutePath, vol)
}

/**
 * Pause Discord audio streaming (keeps the connection alive).
 */
export function pauseStream(): void {
  if (player) {
    player.pause(true)
    log('Stream paused')
  }
}

/**
 * Resume Discord audio streaming after a pause.
 */
export function resumeStream(): void {
  if (player) {
    player.unpause()
    log('Stream resumed')
  }
}

/**
 * Stop streaming audio to Discord (e.g. when local playback stops).
 */
export function stopStream(): void {
  vlog(`stopStream: currentTrack=${currentTrack}, sfxPlaying=${sfxPlaying}`)
  currentTrack = null
  currentResource = null
  sfxPlaying = false
  sfxTransitioning = false
  sfxQueue = []
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
