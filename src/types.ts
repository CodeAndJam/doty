export interface ProgressPayload {
  modelId?: string
  percent: number
  downloadedMB: number
  totalMB: number
}

export interface SttDownloadState {
  downloading: { modelId: string; percent: number } | null
  error: { modelId: string; error: string } | null
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

// ── SFX types ───────────────────────────────────────────────────────

export interface SfxMeta {
  id: string
  filename: string
  category: string
  label: string
  description: string
  /** Duration in seconds */
  duration: number
  /** Whether this is a built-in or user-provided SFX */
  source: 'builtin' | 'custom'
  /** Attribution info for Creative Commons content */
  attribution?: {
    author: string
    license: string
    sourceUrl?: string
  }
}

export type SfxCategory =
  | 'nature'
  | 'fire'
  | 'combat'
  | 'footsteps'
  | 'doors'
  | 'tavern'
  | 'horror'
  | 'magic'
  | 'environment'
  | 'custom'

export const SFX_CATEGORY_LABELS: Record<SfxCategory, string> = {
  nature: 'Nature & Weather',
  fire: 'Fire & Heat',
  combat: 'Combat & Action',
  footsteps: 'Footsteps & Movement',
  doors: 'Doors & Mechanisms',
  tavern: 'Tavern & Social',
  horror: 'Horror & Suspense',
  magic: 'Magic & Supernatural',
  environment: 'Environment & Ambience',
  custom: 'Custom Effects',
}

export interface SfxPlaybackChannel {
  id: string
  sfxId: string
  label: string
  playing: boolean
  looping: boolean
  volume: number
}

// ── Decision log (beta) ─────────────────────────────────────────────

export interface DecisionLogEntry {
  timestamp: number
  ranker: 'model' | 'heuristic' | null
  confidence: number
  topTrack: string | null
  transcriptSnippet: string
  /** Optional autopilot action/reason (when entry comes from autopilot) */
  action?: string
  reason?: string
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

export type MicPermission = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

export interface DotyAPI {
  // Microphone Permission
  micCheckPermission: () => Promise<MicPermission>
  micRequestPermission: () => Promise<boolean>
  micOpenSettings: () => Promise<void>

  // STT
  sttStart: () => Promise<{ ok: boolean; reason?: string }>
  sttStop: () => Promise<{ ok: boolean }>
  sttTranscribeChunk: (buffer: ArrayBuffer) => Promise<{ text: string }>
  onTranscript: (cb: (data: { text: string; elapsedMs: number }) => void) => () => void
  onSttStatus: (cb: (status: string) => void) => () => void
  onSttInterim: (cb: (text: string) => void) => () => void
  onParagraphBreak: (cb: () => void) => () => void
  onSttModelSwitched: (cb: (info: { id: string; label: string }) => void) => () => void

  // Music
  pickMusicFolder: () => Promise<string | null>
  getMusicFolder: () => Promise<string>
  setMusicFolder: (path: string) => Promise<{ ok: boolean }>
  listMusic: () => Promise<string[]>
  getAllMetadata: () => Promise<Record<string, TrackMeta>>

  // Model
  modelStatus: () => Promise<{ ready: boolean; onboardingSkipped: boolean }>
  downloadModel: (modelId?: string) => Promise<{ ok: boolean; reason?: string }>
  getSttDownloadState: () => Promise<SttDownloadState>
  cancelSttDownload: () => Promise<{ ok: boolean }>
  skipModelOnboarding: () => Promise<{ ok: boolean }>
  getSttModelList: () => Promise<
    Array<{
      id: string
      label: string
      description: string
      size: string
      streaming: boolean
      languages: string[]
      default?: boolean
      ready: boolean
    }>
  >
  rankerStatus: () => Promise<{ cached: boolean; downloading: boolean; languageCovered: boolean }>
  rankerDecide: (prompt: string, candidates: string[]) => Promise<number[]>
  rankerDownload: () => Promise<{ ok: boolean; reason?: string }>
  sessionEvaluate: (request: {
    state: string
    /** Option text handed to the model: described tracks, not filenames. */
    candidates: string[]
    /** The same candidates as file paths, in the same order. */
    paths: string[]
    msUntilTrackEnd: number | null
    autopilot: boolean
    override: boolean
  }) => Promise<{
    tracks: number[]
    moods: number[]
    plan: { scene: string; action: 'hold' | 'queue-next' | 'play-now'; reason: string; track: string | null } | null
  }>
  sessionDecision: (row: {
    at: number
    kind: string
    action: string
    reason: string
    track: string | null
    probability: number
    mood: string | null
    source: 'auto' | 'manual'
  }) => Promise<unknown>
  sessionPreference: (row: {
    at: number
    segment: string
    track: string
    scene: string | null
    source: 'auto' | 'manual'
  }) => Promise<unknown>
  sessionReport: (since: number) => Promise<{
    decisions: number
    autoActions: number
    manualPicks: number
    overrideRate: number
  }>
  onRankerDownloadProgress: (cb: (p: { percent: number; status: string }) => void) => () => void
  onRankerStatus: (cb: (status: string) => void) => () => void
  getRecommendationCount: () => Promise<number>
  setRecommendationCount: (count: number) => Promise<{ ok: boolean }>
  onModelProgress: (cb: (p: ProgressPayload) => void) => () => void
  onModelStatus: (cb: (s: { ready: boolean }) => void) => () => void
  onModelDownloadError: (cb: (e: { modelId: string; error: string }) => void) => () => void
  onModelDownloadCancelled: (cb: (e: { modelId: string }) => void) => () => void

  // STT model selection
  getSttModel: () => Promise<string>
  setSttModel: (model: string) => Promise<{ ok: boolean }>
  getSttLanguage: () => Promise<string>
  setSttLanguage: (language: string) => Promise<{ ok: boolean; reason?: string }>
  getSttModelStatus: () => Promise<Record<string, boolean>>

  // Transcripts
  getTranscriptFolder: () => Promise<string>
  pickTranscriptFolder: () => Promise<string | null>
  saveTranscript: (text: string) => Promise<{ ok: boolean; file?: string; reason?: string }>

  // Sessions
  sessionCreate: (name?: string) => Promise<{ file: string; name: string; created: string }>
  sessionList: () => Promise<Array<{ file: string; name: string; created: string }>>
  sessionLoad: (file: string) => Promise<Array<{ start: string; end: string; text: string }>>
  sessionRename: (file: string, newName: string) => Promise<void>
  sessionDelete: (file: string) => Promise<{ ok: boolean }>
  sessionGetLast: () => Promise<string | null>
  sessionSetActive: (file: string) => Promise<{ ok: boolean }>

  // Reprocess
  reprocessStart: (sessionFile: string, modelId: string) => Promise<{ ok: boolean; reason?: string }>
  reprocessCancel: () => Promise<{ ok: boolean }>
  onReprocessProgress: (cb: (p: { percent: number }) => void) => () => void
  onReprocessDone: (cb: (r: { file: string; cueCount: number }) => void) => () => void
  onReprocessError: (cb: (e: { message: string }) => void) => () => void

  // Scanner
  triggerScan: () => Promise<{ ok: boolean }>
  onScanProgress: (cb: (p: ScanProgress) => void) => () => void
  onScanComplete: (cb: () => void) => () => void
  onMusicFolderChanged: (cb: (folder: string) => void) => () => void
  onSessionsChanged: (cb: () => void) => () => void
  onSfxChanged: (cb: () => void) => () => void

  // Tags
  getTags: (filename: string) => Promise<string[]>
  setTags: (filename: string, tags: string[]) => Promise<{ ok: boolean }>
  getAllTags: () => Promise<string[]>
  getTagsMap: () => Promise<Record<string, string[]>>

  // Play History
  recordPlay: (itemId: string, itemType: 'music' | 'sfx') => Promise<{ ok: boolean }>
  getPlayFrequencies: (itemType: 'music' | 'sfx') => Promise<Record<string, number>>
  getTopPlayed: (itemType: 'music' | 'sfx', limit?: number) => Promise<string[]>

  // SFX
  getSfxList: () => Promise<SfxMeta[]>
  getSfxFolder: () => Promise<string>
  pickSfxFolder: () => Promise<string | null>
  setSfxFolder: (path: string) => Promise<{ ok: boolean }>
  getSfxRecommendationCount: () => Promise<number>
  setSfxRecommendationCount: (count: number) => Promise<{ ok: boolean }>

  // Autopilot (#12)
  getAutopilotConfig: () => Promise<import('./lib/autopilot').AutopilotConfig>
  setAutopilotConfig: (config: Partial<import('./lib/autopilot').AutopilotConfig>) => Promise<{ ok: boolean }>

  // Discord
  discordConnect: (token?: string) => Promise<{ ok: boolean; error?: string }>
  discordDisconnect: () => Promise<{ ok: boolean }>
  discordGetState: () => Promise<DiscordState>
  discordGetGuilds: () => Promise<DiscordGuild[]>
  discordGetVoiceChannels: (guildId: string) => Promise<DiscordVoiceChannel[]>
  discordJoinChannel: (guildId: string, channelId: string) => Promise<{ ok: boolean; error?: string }>
  discordLeaveChannel: () => Promise<{ ok: boolean }>
  discordStreamTrack: (filename: string, seekSeconds?: number) => Promise<{ ok: boolean }>
  discordStreamSfx: (absolutePath: string, volume?: number) => Promise<{ ok: boolean }>
  discordStopStream: () => Promise<{ ok: boolean }>
  discordStopSfx: (absolutePath?: string) => Promise<{ ok: boolean }>
  discordPauseStream: () => Promise<{ ok: boolean }>
  discordResumeStream: () => Promise<{ ok: boolean }>
  discordSetVolume: (volume: number) => Promise<{ ok: boolean }>
  discordGetVolume: () => Promise<number>
  discordHasToken: () => Promise<boolean>
  discordClearToken: () => Promise<{ ok: boolean }>
  discordGetAutoConnect: () => Promise<boolean>
  discordSetAutoConnect: (enabled: boolean) => Promise<{ ok: boolean }>
  onDiscordState: (cb: (state: DiscordState) => void) => () => void
}

declare global {
  interface Window {
    doty: DotyAPI
  }
}
