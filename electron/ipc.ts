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
  // Discord
  discordState: 'discord:state',
} as const

export type InvokeChannel = (typeof INVOKE)[keyof typeof INVOKE]
export type EventChannel = (typeof EVENTS)[keyof typeof EVENTS]
