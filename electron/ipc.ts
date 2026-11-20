/**
 * Every renderer <-> main channel, declared once.
 *
 * preload.ts and main.ts reference these names, so a channel cannot be
 * half-wired: an undeclared name fails to typecheck, and ipc.test.ts rejects
 * raw channel strings in either process.
 */

export const INVOKE = {
  // Microphone Permission
  micCheckPermission: 'mic:check-permission',
  micRequestPermission: 'mic:request-permission',
  micOpenSettings: 'mic:open-settings',
  // STT
  sttStart: 'stt:start',
  sttStop: 'stt:stop',
  sttTranscribeChunk: 'stt:transcribe-chunk',
  // Music
  pickMusicFolder: 'music:pick-folder',
  getMusicFolder: 'music:get-folder',
  setMusicFolder: 'music:set-folder',
  listMusic: 'music:list',
  getAllMetadata: 'music:get-all-metadata',
  recommendSignals: 'recommend:signals',
  // Model
  modelStatus: 'model:status',
  downloadModel: 'model:download',
  getSttDownloadState: 'stt:get-download-state',
  cancelSttDownload: 'stt:cancel-download',
  skipModelOnboarding: 'stt:skip-onboarding',
  getSttModelList: 'stt:get-model-list',
  rankerStatus: 'ranker:status',
  rankerDecide: 'ranker:decide',
  rankerDownload: 'ranker:download',
  sessionEvaluate: 'session:evaluate',
  sessionDecision: 'session:decision',
  sessionPreference: 'session:preference',
  sessionReport: 'session:report',
  embeddingStatus: 'embedding:status',
  librarySearch: 'library:search',
  libraryLanes: 'library:lanes',
  sfxRank: 'session:sfx-rank',
  moveTrack: 'library:move-track',
  setLane: 'library:set-lane',
  getRecommendationCount: 'settings:get-recommendation-count',
  setRecommendationCount: 'settings:set-recommendation-count',
  // STT model selection
  getSttModel: 'stt:get-model',
  setSttModel: 'stt:set-model',
  getSttLanguage: 'stt:get-language',
  setSttLanguage: 'stt:set-language',
  getSttModelStatus: 'stt:get-model-status',
  // Transcripts
  getTranscriptFolder: 'transcript:get-folder',
  pickTranscriptFolder: 'transcript:pick-folder',
  saveTranscript: 'transcript:save',
  // Sessions
  sessionCreate: 'session:create',
  sessionList: 'session:list',
  sessionLoad: 'session:load',
  sessionRename: 'session:rename',
  sessionDelete: 'session:delete',
  sessionGetLast: 'session:get-last',
  sessionSetActive: 'session:set-active',
  // Reprocess
  reprocessStart: 'reprocess:start',
  reprocessCancel: 'reprocess:cancel',
  // Scanner
  triggerScan: 'music:scan',
  // Tags
  getTags: 'tags:get',
  setTags: 'tags:set',
  getAllTags: 'tags:get-all',
  getTagsMap: 'tags:get-map',
  // Play History
  recordPlay: 'history:record-play',
  getPlayFrequencies: 'history:get-frequencies',
  getTopPlayed: 'history:get-top-played',
  // SFX
  getSfxList: 'sfx:list',
  getSfxFolder: 'sfx:get-folder',
  pickSfxFolder: 'sfx:pick-folder',
  setSfxFolder: 'sfx:set-folder',
  getSfxRecommendationCount: 'settings:get-sfx-recommendation-count',
  setSfxRecommendationCount: 'settings:set-sfx-recommendation-count',
  // Autopilot (#12)
  getAutopilotConfig: 'autopilot:get-config',
  setAutopilotConfig: 'autopilot:set-config',
  // Updates
  updateGetState: 'update:get-state',
  updateCheck: 'update:check',
  appVersion: 'app:version',
  updateInstall: 'update:install',
  // Models
  deleteModel: 'model:delete',
  // Debug
  debugGetState: 'debug:get-state',
  debugSetEnabled: 'debug:set-enabled',
  debugOpenLog: 'debug:open-log',
  // Lights (Home Assistant on the LAN)
  lightsGetState: 'lights:get-state',
  lightsConfigure: 'lights:configure',
  lightsClear: 'lights:clear',
  lightsDiscover: 'lights:discover',
  lightsSetArea: 'lights:set-area',
  lightsSetAuto: 'lights:set-auto',
  lightsSetPower: 'lights:set-power',
  lightsSetBrightness: 'lights:set-brightness',
  lightsSetLight: 'lights:set-light',
  lightsSetPulse: 'lights:set-pulse',
  lightsSetMood: 'lights:set-mood',
  lightsSetHint: 'lights:set-hint',
  lightsResume: 'lights:resume',
  // Discord
  discordConnect: 'discord:connect',
  discordDisconnect: 'discord:disconnect',
  discordGetState: 'discord:get-state',
  discordGetGuilds: 'discord:get-guilds',
  discordGetVoiceChannels: 'discord:get-voice-channels',
  discordJoinChannel: 'discord:join-channel',
  discordLeaveChannel: 'discord:leave-channel',
  discordStreamTrack: 'discord:stream-track',
  discordStreamSfx: 'discord:stream-sfx',
  discordStopStream: 'discord:stop-stream',
  discordStopSfx: 'discord:stop-sfx',
  discordPauseStream: 'discord:pause-stream',
  discordResumeStream: 'discord:resume-stream',
  discordSetVolume: 'discord:set-volume',
  discordGetVolume: 'discord:get-volume',
  discordHasToken: 'discord:has-token',
  discordClearToken: 'discord:clear-token',
  discordGetAutoConnect: 'discord:get-auto-connect',
  discordSetAutoConnect: 'discord:set-auto-connect',
  discordGetCaptureState: 'discord:get-capture-state',
  discordSetCaptureMode: 'discord:set-capture-mode',
  discordGetSendTranscript: 'discord:get-send-transcript',
  discordSetSendTranscript: 'discord:set-send-transcript',
} as const

export const EVENTS = {
  // STT
  transcript: 'stt:transcript',
  sttStatus: 'stt:status',
  sttInterim: 'stt:interim',
  paragraphBreak: 'stt:paragraph-break',
  sttModelSwitched: 'stt:model-switched',
  // Music
  // Model
  rankerStatus: 'ranker:ipc-status',
  rankerDownloadProgress: 'ranker:download-progress',
  embeddingProgress: 'embedding:progress',
  modelProgress: 'model:progress',
  modelStatus: 'model:status',
  modelDownloadError: 'model:download-error',
  modelDownloadCancelled: 'model:download-cancelled',
  // Reprocess
  reprocessProgress: 'reprocess:progress',
  reprocessDone: 'reprocess:done',
  reprocessError: 'reprocess:error',
  // Scanner
  scanProgress: 'scan:progress',
  scanComplete: 'scan:complete',
  musicFolderChanged: 'music:folder-changed',
  sessionsChanged: 'sessions:changed',
  sfxChanged: 'sfx:changed',
  // Updates
  updateState: 'update:state',
  // Lights
  lightsState: 'lights:state',
  // Discord
  discordState: 'discord:state',
  captureState: 'capture:state',
} as const

export type InvokeChannel = (typeof INVOKE)[keyof typeof INVOKE]
export type EventChannel = (typeof EVENTS)[keyof typeof EVENTS]
