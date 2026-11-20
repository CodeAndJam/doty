export interface ProgressPayload {
  modelId?: string
  percent: number
  downloadedMB: number
  totalMB: number
}

/** The lights a session can reach, as the panel sees them. */
export type LightStatus = 'off' | 'connecting' | 'connected' | 'needs-reconnect'

export interface LightView {
  entityId: string
  name: string
  on: boolean
  /** Current level, 1–100, when Home Assistant reports one. */
  brightnessPct: number | null
  /** Current colour, when the light has one. */
  rgb: [number, number, number] | null
  /** False when the light accepts no colour at all. */
  canColor: boolean
  /** Animations this light advertises; empty when it has none. */
  effectList: string[]
  effect: string | null
}

/** One manual change to one light, from the session pane. */
export interface LightPatch {
  on?: boolean
  brightnessPct?: number
  rgb?: [number, number, number]
  effect?: string
}

export interface LightsState {
  /** False until a Home Assistant URL and token are stored: the UI shows nothing. */
  configured: boolean
  status: LightStatus
  /** Why the last connection attempt failed, when it did. */
  error?: string
  url: string
  areas: Array<{ areaId: string; name: string }>
  areaId: string
  auto: boolean
  /** The Session Hint, as stored for this session. */
  hint: string
  mood: string | null
  /** Who set the current Area Preset. */
  producer: 'mood' | 'hint' | null
  /** When the DM's manual change stops pausing auto, in epoch ms. */
  pausedUntil: number | null
  /** False when any light in the Area cannot take a colour. */
  canColor: boolean
  /** True while the app-side breathing animation is running. */
  pulse: boolean
  lights: LightView[]
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

/** How far the library index has got: two phases, and why it may be stopped. */
export interface IndexProgress {
  ready: boolean
  phase: 'idle' | 'text' | 'audio'
  paused: boolean
  /** Items with a text vector, over the whole library. */
  indexed: number
  total: number
  phaseDone: number
  phaseTotal: number
}

/** The session KPI chip: what the automation did, and what the DM took back. */
export interface SessionReport {
  decisions: number
  autoActions: number
  manualPicks: number
  overrideRate: number
  autoChangeRetention: number | null
  timeToFirstManualPickMs: number | null
}

export interface TrackMeta {
  bpm: number
  bpmConfidence: number
  key: string
  scale: string
  danceability: number
  energy: number
  /** Audio-embedding verdict, filled by the background pass when it has run. */
  audioKind?: 'music' | 'sfx' | 'uncertain'
  /** The resolved lane label, which may differ from the folder the file is in. */
  lane?: 'music' | 'sfx'
  /** dBFS; optional because payloads written before the energy fix lack it. */
  loudness?: number
  analysisVersion?: number
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
  /** The resolved lane label; an effect can be labelled as a cue and vice versa. */
  lane?: 'music' | 'sfx'
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

export interface CaptureState {
  mode: 'local' | 'all'
  /** Display names of the participants whose audio goes into the session. */
  names: string[]
  /** Why capture is not running, when it should be. */
  error: string | null
}

export interface DiscordState {
  status: DiscordStatus
  voiceStatus: DiscordVoiceStatus
  currentGuildId: string | null
  currentChannelId: string | null
  error: string | null
}

export type MicPermission = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

/**
 * The updater's one state: a newer release is offered, downloaded, and swapped
 * in after quit. Nothing here ever interrupts playback.
 */
export type UpdateState =
  | { status: 'idle' }
  | { status: 'available'; version: string; sizeMB: number }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'installing'; version: string }
  | { status: 'error'; version: string; error: string }

/** What the Advanced tab needs to explain a machine that misbehaves. */
export interface DebugState {
  enabled: boolean
  logPath: string
  /** Recent log lines, oldest first; empty until debug mode writes something. */
  log: string
  /** Versions, paths and the checks that explain "connected but silent". */
  diagnostics: string
}

export interface DotyAPI {
  // Microphone Permission
  micCheckPermission: () => Promise<MicPermission>
  micRequestPermission: () => Promise<boolean>
  micOpenSettings: () => Promise<void>

  // STT
  sttStart: () => Promise<{ ok: boolean; reason?: string }>
  sttStop: () => Promise<{ ok: boolean }>
  sttTranscribeChunk: (buffer: ArrayBuffer) => Promise<{ text: string }>
  onTranscript: (cb: (data: { text: string; elapsedMs: number; speaker?: string }) => void) => () => void
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
  /** Everything a ranking pass reads, in one round trip. */
  recommendSignals: () => Promise<{
    metadata: Record<string, TrackMeta>
    tagsMap: Record<string, string[]>
    playFrequencies: Record<string, number>
  }>

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
  // Lights (Home Assistant on the LAN)
  lightsGetState: (session?: string | null) => Promise<LightsState>
  lightsConfigure: (input: { url: string; token?: string }) => Promise<LightsState>
  lightsClear: () => Promise<LightsState>
  lightsDiscover: () => Promise<Array<{ name: string; url: string }>>
  lightsSetArea: (session: string | null, areaId: string) => Promise<LightsState>
  lightsSetAuto: (enabled: boolean) => Promise<LightsState>
  lightsSetPower: (on: boolean) => Promise<LightsState>
  lightsSetBrightness: (percent: number) => Promise<LightsState>
  lightsSetLight: (entityId: string, patch: LightPatch) => Promise<LightsState>
  lightsSetPulse: (enabled: boolean) => Promise<LightsState>
  lightsSetMood: (mood: string) => Promise<LightsState>
  lightsSetHint: (session: string | null, hint: string) => Promise<LightsState>
  lightsResume: () => Promise<LightsState>
  onLightsState: (cb: (state: LightsState) => void) => () => void

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
    musicEnabled: boolean
    /** The DM's threshold from Settings; absent keeps the policy default. */
    confidenceThreshold?: number
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
    source: 'auto' | 'manual' | 'hint'
  }) => Promise<unknown>
  sessionPreference: (row: {
    at: number
    segment: string
    track: string
    scene: string | null
    /** `reject` records a skip, so history can tell a choice from a dismissal. */
    source: 'auto' | 'manual' | 'reject'
  }) => Promise<unknown>
  embeddingStatus: () => Promise<IndexProgress>
  /**
   * The lane of every item, keyed by the path each panel renders (relative for a
   * music-folder file, absolute for an effects-folder file).
   */
  libraryLanes: () => Promise<Record<string, { key: string; lane: 'music' | 'sfx'; origin: 'music' | 'sfx' }>>
  /**
   * Search one lane. Semantic when every track on that lane is embedded; `mode`
   * says which matcher answered, so the panel can show the fallback.
   */
  librarySearch: (
    text: string,
    lane: 'music' | 'sfx',
    k: number,
  ) => Promise<{
    mode: 'semantic' | 'text'
    items: Array<{ key: string; path: string; lane: 'music' | 'sfx'; absolute: string; origin: 'music' | 'sfx' }>
  }>
  /** Probabilities for each SFX description, in the order given. */
  sfxRank: (state: string, candidates: string[]) => Promise<number[]>
  /** Move one file between the music and effects libraries, on request. */
  moveTrack: (path: string, target: 'music' | 'sfx') => Promise<{ ok: boolean; reason?: string; path?: string }>
  /** Label a track without touching the disk: a lane is a label, not a folder. */
  setLane: (key: string, lane: 'music' | 'sfx') => Promise<{ ok: boolean }>
  onEmbeddingProgress: (cb: (p: IndexProgress) => void) => () => void
  sessionReport: (since: number) => Promise<SessionReport>
  onRankerDownloadProgress: (cb: (p: { percent: number; status: string; reason?: string }) => void) => () => void
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
  sessionLoad: (file: string) => Promise<Array<{ start: string; end: string; text: string; speaker?: string }>>
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

  // Debug
  debugGetState: () => Promise<DebugState>
  debugSetEnabled: (enabled: boolean) => Promise<DebugState>
  debugOpenLog: () => Promise<{ ok: boolean; error?: string }>

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
  discordGetCaptureState: () => Promise<CaptureState>
  discordSetCaptureMode: (mode: 'local' | 'all') => Promise<{ ok: boolean; error?: string }>
  discordGetSendTranscript: () => Promise<boolean>
  discordSetSendTranscript: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>
  onDiscordState: (cb: (state: DiscordState) => void) => () => void
  /** Capture mode, who is being captured, and why it stopped. */
  onCaptureState: (cb: (state: CaptureState) => void) => () => void

  // Updates
  updateState: () => Promise<UpdateState>
  /** Download and swap in the offered release, then quit. */
  updateInstall: () => Promise<{ ok: boolean; error?: string }>
  updateCheck: () => Promise<{
    ok: boolean
    status: 'current' | 'available' | 'error'
    version?: string
    error?: string
  }>
  appVersion: () => Promise<string>
  /** Delete a downloaded model; the next use downloads it again. */
  deleteModel: (kind: 'stt' | 'ranker' | 'embedder', id?: string) => Promise<{ ok: boolean; reason?: string }>
  onUpdateState: (cb: (state: UpdateState) => void) => () => void
}

declare global {
  interface Window {
    doty: DotyAPI
  }
}
