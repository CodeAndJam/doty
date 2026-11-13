import { contextBridge, ipcRenderer } from 'electron'
import { EVENTS, type EventChannel, INVOKE, type InvokeChannel } from './ipc'

const invoke = (channel: InvokeChannel, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const subscribe = <T>(channel: EventChannel, cb: (payload: T) => void) => {
  const handler = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

export type ProgressPayload = { modelId?: string; percent: number; downloadedMB: number; totalMB: number }

contextBridge.exposeInMainWorld('doty', {
  // Microphone Permission
  micCheckPermission: () => invoke(INVOKE.micCheckPermission),
  micRequestPermission: () => invoke(INVOKE.micRequestPermission),
  micOpenSettings: () => invoke(INVOKE.micOpenSettings),

  // STT
  sttStart: () => invoke(INVOKE.sttStart),
  sttStop: () => invoke(INVOKE.sttStop),
  sttTranscribeChunk: (buffer: ArrayBuffer) => invoke(INVOKE.sttTranscribeChunk, buffer),
  onTranscript: (cb: (data: { text: string; elapsedMs: number }) => void) => subscribe(EVENTS.transcript, cb),
  onSttStatus: (cb: (status: string) => void) => subscribe(EVENTS.sttStatus, cb),
  onSttInterim: (cb: (text: string) => void) => subscribe(EVENTS.sttInterim, cb),
  onParagraphBreak: (cb: () => void) => subscribe(EVENTS.paragraphBreak, cb),
  onSttModelSwitched: (cb: (info: { id: string; label: string }) => void) => subscribe(EVENTS.sttModelSwitched, cb),

  // Music
  pickMusicFolder: () => invoke(INVOKE.pickMusicFolder),
  getMusicFolder: () => invoke(INVOKE.getMusicFolder),
  setMusicFolder: (path: string) => invoke(INVOKE.setMusicFolder, path),
  listMusic: () => invoke(INVOKE.listMusic),
  getAllMetadata: () => invoke(INVOKE.getAllMetadata),

  // Model
  modelStatus: () => invoke(INVOKE.modelStatus),
  downloadModel: (modelId?: string) => invoke(INVOKE.downloadModel, modelId),
  getSttDownloadState: () => invoke(INVOKE.getSttDownloadState),
  cancelSttDownload: () => invoke(INVOKE.cancelSttDownload),
  skipModelOnboarding: () => invoke(INVOKE.skipModelOnboarding),
  getSttModelList: () => invoke(INVOKE.getSttModelList),
  rankerStatus: () => invoke(INVOKE.rankerStatus),
  rankerDecide: (prompt: string, candidates: string[]) => invoke(INVOKE.rankerDecide, prompt, candidates),
  rankerDownload: () => invoke(INVOKE.rankerDownload) as Promise<{ ok: boolean; reason?: string }>,
  sessionEvaluate: (request: {
    state: string
    candidates: string[]
    msUntilTrackEnd: number | null
    autopilot: boolean
    override: boolean
  }) => invoke(INVOKE.sessionEvaluate, request),
  sessionDecision: (row: unknown) => invoke(INVOKE.sessionDecision, row),
  sessionPreference: (row: unknown) => invoke(INVOKE.sessionPreference, row),
  sessionReport: (since: number) => invoke(INVOKE.sessionReport, since),
  onRankerDownloadProgress: (cb: (p: { percent: number; status: string }) => void) =>
    subscribe(EVENTS.rankerDownloadProgress, cb),
  onRankerStatus: (cb: (status: string) => void) => subscribe(EVENTS.rankerStatus, cb),
  getRecommendationCount: () => invoke(INVOKE.getRecommendationCount),
  setRecommendationCount: (count: number) => invoke(INVOKE.setRecommendationCount, count),
  onModelProgress: (cb: (p: ProgressPayload) => void) => subscribe(EVENTS.modelProgress, cb),
  onModelStatus: (cb: (s: { ready: boolean }) => void) => subscribe(EVENTS.modelStatus, cb),
  onModelDownloadError: (cb: (e: { modelId: string; error: string }) => void) =>
    subscribe(EVENTS.modelDownloadError, cb),
  onModelDownloadCancelled: (cb: (e: { modelId: string }) => void) => subscribe(EVENTS.modelDownloadCancelled, cb),

  // STT model selection
  getSttModel: () => invoke(INVOKE.getSttModel),
  setSttModel: (model: string) => invoke(INVOKE.setSttModel, model),
  getSttLanguage: () => invoke(INVOKE.getSttLanguage),
  setSttLanguage: (language: string) => invoke(INVOKE.setSttLanguage, language),
  getSttModelStatus: () => invoke(INVOKE.getSttModelStatus),

  // Transcripts
  getTranscriptFolder: () => invoke(INVOKE.getTranscriptFolder),
  pickTranscriptFolder: () => invoke(INVOKE.pickTranscriptFolder),
  saveTranscript: (text: string) => invoke(INVOKE.saveTranscript, text),

  // Sessions
  sessionCreate: (name?: string) => invoke(INVOKE.sessionCreate, name),
  sessionList: () => invoke(INVOKE.sessionList),
  sessionLoad: (file: string) => invoke(INVOKE.sessionLoad, file),
  sessionRename: (file: string, newName: string) => invoke(INVOKE.sessionRename, file, newName),
  sessionDelete: (file: string) => invoke(INVOKE.sessionDelete, file),
  sessionGetLast: () => invoke(INVOKE.sessionGetLast),
  sessionSetActive: (file: string) => invoke(INVOKE.sessionSetActive, file),

  // Reprocess
  reprocessStart: (sessionFile: string, modelId: string) => invoke(INVOKE.reprocessStart, sessionFile, modelId),
  reprocessCancel: () => invoke(INVOKE.reprocessCancel),
  onReprocessProgress: (cb: (p: { percent: number }) => void) => subscribe(EVENTS.reprocessProgress, cb),
  onReprocessDone: (cb: (r: { file: string; cueCount: number }) => void) => subscribe(EVENTS.reprocessDone, cb),
  onReprocessError: (cb: (e: { message: string }) => void) => subscribe(EVENTS.reprocessError, cb),

  // Scanner
  triggerScan: () => invoke(INVOKE.triggerScan),
  onScanProgress: (cb: (p: { done: number; total: number; current: string }) => void) =>
    subscribe(EVENTS.scanProgress, cb),
  onScanComplete: (cb: () => void) => subscribe(EVENTS.scanComplete, cb),
  onMusicFolderChanged: (cb: (folder: string) => void) => subscribe(EVENTS.musicFolderChanged, cb),
  onSessionsChanged: (cb: () => void) => subscribe(EVENTS.sessionsChanged, cb),
  onSfxChanged: (cb: () => void) => subscribe(EVENTS.sfxChanged, cb),

  // Tags
  getTags: (filename: string) => invoke(INVOKE.getTags, filename),
  setTags: (filename: string, tags: string[]) => invoke(INVOKE.setTags, filename, tags),
  getAllTags: () => invoke(INVOKE.getAllTags),
  getTagsMap: () => invoke(INVOKE.getTagsMap),

  // Play History
  recordPlay: (itemId: string, itemType: 'music' | 'sfx') => invoke(INVOKE.recordPlay, itemId, itemType),
  getPlayFrequencies: (itemType: 'music' | 'sfx') => invoke(INVOKE.getPlayFrequencies, itemType),
  getTopPlayed: (itemType: 'music' | 'sfx', limit?: number) => invoke(INVOKE.getTopPlayed, itemType, limit),

  // SFX
  getSfxList: () => invoke(INVOKE.getSfxList),
  getSfxFolder: () => invoke(INVOKE.getSfxFolder),
  pickSfxFolder: () => invoke(INVOKE.pickSfxFolder),
  setSfxFolder: (path: string) => invoke(INVOKE.setSfxFolder, path),
  getSfxRecommendationCount: () => invoke(INVOKE.getSfxRecommendationCount),
  setSfxRecommendationCount: (count: number) => invoke(INVOKE.setSfxRecommendationCount, count),

  // Autopilot (#12)
  getAutopilotConfig: () => invoke(INVOKE.getAutopilotConfig),
  setAutopilotConfig: (config: Record<string, unknown>) => invoke(INVOKE.setAutopilotConfig, config),

  // Discord
  discordConnect: (token?: string) => invoke(INVOKE.discordConnect, token),
  discordDisconnect: () => invoke(INVOKE.discordDisconnect),
  discordGetState: () => invoke(INVOKE.discordGetState),
  discordGetGuilds: () => invoke(INVOKE.discordGetGuilds),
  discordGetVoiceChannels: (guildId: string) => invoke(INVOKE.discordGetVoiceChannels, guildId),
  discordJoinChannel: (guildId: string, channelId: string) => invoke(INVOKE.discordJoinChannel, guildId, channelId),
  discordLeaveChannel: () => invoke(INVOKE.discordLeaveChannel),
  discordStreamTrack: (filename: string, seekSeconds?: number) =>
    invoke(INVOKE.discordStreamTrack, filename, seekSeconds),
  discordStreamSfx: (absolutePath: string, volume?: number) => invoke(INVOKE.discordStreamSfx, absolutePath, volume),
  discordStopStream: () => invoke(INVOKE.discordStopStream),
  discordStopSfx: (absolutePath?: string) => invoke(INVOKE.discordStopSfx, absolutePath),
  discordPauseStream: () => invoke(INVOKE.discordPauseStream),
  discordResumeStream: () => invoke(INVOKE.discordResumeStream),
  discordSetVolume: (volume: number) => invoke(INVOKE.discordSetVolume, volume),
  discordGetVolume: () => invoke(INVOKE.discordGetVolume),
  discordHasToken: () => invoke(INVOKE.discordHasToken),
  discordClearToken: () => invoke(INVOKE.discordClearToken),
  discordGetAutoConnect: () => invoke(INVOKE.discordGetAutoConnect),
  discordSetAutoConnect: (enabled: boolean) => invoke(INVOKE.discordSetAutoConnect, enabled),
  onDiscordState: (cb: (state: any) => void) => subscribe(EVENTS.discordState, cb),
})
