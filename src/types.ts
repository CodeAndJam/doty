export interface ProgressPayload {
  percent: number
  downloadedMB: number
  totalMB: number
}

export interface ScanProgress {
  done: number
  total: number
  current: string
}

export interface TrackMeta {
  bpm: number
  bpmConfidence: number
  key: string
  scale: string
  danceability: number
  energy: number
  duration: number
  mtime: number
  title: string | null
  artist: string | null
  album: string | null
  genre: string | null
  year: number | null
  trackNo: number | null
  bitrate: number | null
  sampleRate: number | null
  channels: number | null
  codec: string | null
}

// ── Playback types ──────────────────────────────────────────────────

export type LoopMode = 'off' | 'single' | 'queue'

export interface PlaybackState {
  /** Currently loaded track filename, or null if nothing loaded */
  track: string | null
  /** Whether audio is actively playing */
  playing: boolean
  /** Playback progress 0..1 */
  progress: number
  /** Current time in seconds */
  currentTime: number
  /** Total duration in seconds */
  duration: number
  /** Volume 0..1 */
  volume: number
  /** Whether audio is muted */
  muted: boolean
  /** Current loop mode */
  loopMode: LoopMode
}

export interface QueueState {
  /** Ordered list of track filenames */
  tracks: string[]
  /** Index of the currently playing track (-1 if queue is empty or not active) */
  currentIndex: number
}

// ── API types ───────────────────────────────────────────────────────

// ── Discord types ───────────────────────────────────────────────────

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

export interface DotyAPI {
  // STT
  sttStart: () => Promise<{ ok: boolean }>
  sttStop: () => Promise<{ ok: boolean }>
  sttTranscribeChunk: (buffer: ArrayBuffer) => Promise<{ text: string }>
  onTranscript: (cb: (text: string) => void) => () => void

  // Music
  pickMusicFolder: () => Promise<string | null>
  getMusicFolder: () => Promise<string>
  setMusicFolder: (path: string) => Promise<{ ok: boolean }>
  listMusic: () => Promise<string[]>
  getAllMetadata: () => Promise<Record<string, TrackMeta>>
  recommendManual: (prompt: string) => Promise<{ ok: boolean }>
  onRecommendations: (cb: (files: string[]) => void) => () => void

  // Model
  modelStatus: () => Promise<{ ready: boolean }>
  downloadModel: () => Promise<{ ok: boolean }>
  rerankerStatus: () => Promise<{ cached: boolean }>
  getRecommendationCount: () => Promise<number>
  setRecommendationCount: (count: number) => Promise<{ ok: boolean }>
  onModelProgress: (cb: (p: ProgressPayload) => void) => () => void
  onModelStatus: (cb: (s: { ready: boolean }) => void) => () => void
  onQwenStatus: (cb: (s: { status: 'loading' | 'ready' }) => void) => () => void

  // Transcripts
  getTranscriptFolder: () => Promise<string>
  pickTranscriptFolder: () => Promise<string | null>
  saveTranscript: (text: string) => Promise<{ ok: boolean; file?: string; reason?: string }>

  // Hotwords
  getHotwordsFile: () => Promise<string>
  setHotwordsFile: (path: string) => Promise<{ ok: boolean }>
  pickHotwordsFile: () => Promise<string | null>
  createDefaultHotwords: () => Promise<{ ok: boolean; path?: string; reason?: string }>

  // Scanner
  triggerScan: () => Promise<{ ok: boolean }>
  onScanProgress: (cb: (p: ScanProgress) => void) => () => void
  onScanComplete: (cb: () => void) => () => void

  // Tags
  getTags: (filename: string) => Promise<string[]>
  setTags: (filename: string, tags: string[]) => Promise<{ ok: boolean }>
  getAllTags: () => Promise<string[]>
  getTagsMap: () => Promise<Record<string, string[]>>

  // Discord
  discordConnect: (token?: string) => Promise<{ ok: boolean; error?: string }>
  discordDisconnect: () => Promise<{ ok: boolean }>
  discordGetState: () => Promise<DiscordState>
  discordGetGuilds: () => Promise<DiscordGuild[]>
  discordGetVoiceChannels: (guildId: string) => Promise<DiscordVoiceChannel[]>
  discordJoinChannel: (guildId: string, channelId: string) => Promise<{ ok: boolean; error?: string }>
  discordLeaveChannel: () => Promise<{ ok: boolean }>
  discordStreamTrack: (filename: string) => Promise<{ ok: boolean }>
  discordStopStream: () => Promise<{ ok: boolean }>
  discordSetVolume: (volume: number) => Promise<{ ok: boolean }>
  discordGetVolume: () => Promise<number>
  discordHasToken: () => Promise<boolean>
  discordClearToken: () => Promise<{ ok: boolean }>
  onDiscordState: (cb: (state: DiscordState) => void) => () => void
}

declare global {
  interface Window {
    doty: DotyAPI
  }
}
