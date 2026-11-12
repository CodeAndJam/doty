import { contextBridge, ipcRenderer } from 'electron'

export type ProgressPayload = { modelId?: string; percent: number; downloadedMB: number; totalMB: number }

contextBridge.exposeInMainWorld('doty', {
  // Microphone Permission
  micCheckPermission: () => ipcRenderer.invoke('mic:check-permission'),
  micRequestPermission: () => ipcRenderer.invoke('mic:request-permission'),
  micOpenSettings: () => ipcRenderer.invoke('mic:open-settings'),

  // STT
  sttStart: () => ipcRenderer.invoke('stt:start'),
  sttStop: () => ipcRenderer.invoke('stt:stop'),
  sttTranscribeChunk: (buffer: ArrayBuffer) => ipcRenderer.invoke('stt:transcribe-chunk', buffer),
  onTranscript: (cb: (data: { text: string; elapsedMs: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { text: string; elapsedMs: number }) => cb(data)
    ipcRenderer.on('stt:transcript', handler)
    return () => ipcRenderer.removeListener('stt:transcript', handler)
  },
  onSttStatus: (cb: (status: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, status: string) => cb(status)
    ipcRenderer.on('stt:status', handler)
    return () => ipcRenderer.removeListener('stt:status', handler)
  },
  onSttInterim: (cb: (text: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, text: string) => cb(text)
    ipcRenderer.on('stt:interim', handler)
    return () => ipcRenderer.removeListener('stt:interim', handler)
  },
  onParagraphBreak: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('stt:paragraph-break', handler)
    return () => ipcRenderer.removeListener('stt:paragraph-break', handler)
  },
  onSttModelSwitched: (cb: (info: { id: string; label: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, info: { id: string; label: string }) => cb(info)
    ipcRenderer.on('stt:model-switched', handler)
    return () => ipcRenderer.removeListener('stt:model-switched', handler)
  },

  // Scene Interpreter (LLM)
  getLlmModelList: () => ipcRenderer.invoke('llm:get-model-list'),
  getLlmModel: () => ipcRenderer.invoke('llm:get-model'),
  setLlmModel: (modelId: string) => ipcRenderer.invoke('llm:set-model', modelId),
  downloadLlm: (modelId: string) => ipcRenderer.invoke('llm:download', modelId),
  downloadEmbeddingModel: () => ipcRenderer.invoke('llm:download-embedding'),
  getEmbeddingStatus: () => ipcRenderer.invoke('llm:get-embedding-status'),
  getEmbeddingProgress: () => ipcRenderer.invoke('embedding:get-progress'),
  onSceneUpdate: (cb: (scene: { scene: string; mood: string; intensity: number; keywords: string[] }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, scene: any) => cb(scene)
    ipcRenderer.on('scene:update', handler)
    return () => ipcRenderer.removeListener('scene:update', handler)
  },
  onLlmStatus: (cb: (status: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, status: string) => cb(status)
    ipcRenderer.on('llm:status', handler)
    return () => ipcRenderer.removeListener('llm:status', handler)
  },
  onLlmDownloadProgress: (cb: (p: { percent: number; downloadedMB: number; totalMB: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: any) => cb(p)
    ipcRenderer.on('llm:download-progress', handler)
    return () => ipcRenderer.removeListener('llm:download-progress', handler)
  },
  onEmbeddingProgress: (cb: (stats: { embedded: number; total: number; percent: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, stats: any) => cb(stats)
    ipcRenderer.on('embedding:progress', handler)
    return () => ipcRenderer.removeListener('embedding:progress', handler)
  },

  // Music
  pickMusicFolder: () => ipcRenderer.invoke('music:pick-folder'),
  getMusicFolder: () => ipcRenderer.invoke('music:get-folder'),
  setMusicFolder: (path: string) => ipcRenderer.invoke('music:set-folder', path),
  listMusic: () => ipcRenderer.invoke('music:list'),
  getAllMetadata: () => ipcRenderer.invoke('music:get-all-metadata'),
  onRecommendations: (cb: (files: string[]) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, files: string[]) => cb(files)
    ipcRenderer.on('music:recommendations', handler)
    return () => ipcRenderer.removeListener('music:recommendations', handler)
  },
  onRecommendationConfidence: (cb: (confidence: number) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, confidence: number) => cb(confidence)
    ipcRenderer.on('recommend:confidence', handler)
    return () => ipcRenderer.removeListener('recommend:confidence', handler)
  },

  // Model
  modelStatus: () => ipcRenderer.invoke('model:status'),
  downloadModel: (modelId?: string) => ipcRenderer.invoke('model:download', modelId),
  getSttDownloadState: () => ipcRenderer.invoke('stt:get-download-state'),
  cancelSttDownload: () => ipcRenderer.invoke('stt:cancel-download'),
  skipModelOnboarding: () => ipcRenderer.invoke('stt:skip-onboarding'),
  getSttModelList: () => ipcRenderer.invoke('stt:get-model-list'),
  rerankerStatus: () => ipcRenderer.invoke('reranker:status'),
  rerankerScore: (pairs: Array<{ text: string; text_pair: string }>) => ipcRenderer.invoke('reranker:score', pairs),
  onRerankerStatus: (cb: (status: string) => void) => {
    const handler = (_e: any, status: string) => cb(status)
    ipcRenderer.on('reranker:ipc-status', handler)
    return () => {
      ipcRenderer.removeListener('reranker:ipc-status', handler)
    }
  },
  onRerankerDownloadProgress: (cb: (p: { file: string; progress: number; status: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: { file: string; progress: number; status: string }) => cb(p)
    ipcRenderer.on('reranker:download-progress', handler)
    return () => ipcRenderer.removeListener('reranker:download-progress', handler)
  },
  getRecommendationCount: () => ipcRenderer.invoke('settings:get-recommendation-count'),
  setRecommendationCount: (count: number) => ipcRenderer.invoke('settings:set-recommendation-count', count),
  onModelProgress: (cb: (p: ProgressPayload) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: ProgressPayload) => cb(p)
    ipcRenderer.on('model:progress', handler)
    return () => ipcRenderer.removeListener('model:progress', handler)
  },
  onModelStatus: (cb: (s: { ready: boolean }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, s: { ready: boolean }) => cb(s)
    ipcRenderer.on('model:status', handler)
    return () => ipcRenderer.removeListener('model:status', handler)
  },
  onModelDownloadError: (cb: (e: { modelId: string; error: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, e: { modelId: string; error: string }) => cb(e)
    ipcRenderer.on('model:download-error', handler)
    return () => ipcRenderer.removeListener('model:download-error', handler)
  },
  onModelDownloadCancelled: (cb: (e: { modelId: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, e: { modelId: string }) => cb(e)
    ipcRenderer.on('model:download-cancelled', handler)
    return () => ipcRenderer.removeListener('model:download-cancelled', handler)
  },

  // STT model selection
  getSttModel: () => ipcRenderer.invoke('stt:get-model'),
  setSttModel: (model: string) => ipcRenderer.invoke('stt:set-model', model),
  getSttLanguage: () => ipcRenderer.invoke('stt:get-language'),
  setSttLanguage: (language: string) => ipcRenderer.invoke('stt:set-language', language),
  getSttModelStatus: () => ipcRenderer.invoke('stt:get-model-status'),

  // Transcripts
  getTranscriptFolder: () => ipcRenderer.invoke('transcript:get-folder'),
  pickTranscriptFolder: () => ipcRenderer.invoke('transcript:pick-folder'),
  saveTranscript: (text: string) => ipcRenderer.invoke('transcript:save', text),

  // Sessions
  sessionCreate: (name?: string) => ipcRenderer.invoke('session:create', name),
  sessionList: () => ipcRenderer.invoke('session:list'),
  sessionLoad: (file: string) => ipcRenderer.invoke('session:load', file),
  sessionRename: (file: string, newName: string) => ipcRenderer.invoke('session:rename', file, newName),
  sessionDelete: (file: string) => ipcRenderer.invoke('session:delete', file),
  sessionGetLast: () => ipcRenderer.invoke('session:get-last'),
  sessionSetActive: (file: string) => ipcRenderer.invoke('session:set-active', file),

  // Reprocess
  reprocessStart: (sessionFile: string, modelId: string) => ipcRenderer.invoke('reprocess:start', sessionFile, modelId),
  reprocessCancel: () => ipcRenderer.invoke('reprocess:cancel'),
  onReprocessProgress: (cb: (p: { percent: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: { percent: number }) => cb(p)
    ipcRenderer.on('reprocess:progress', handler)
    return () => ipcRenderer.removeListener('reprocess:progress', handler)
  },
  onReprocessDone: (cb: (r: { file: string; cueCount: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, r: { file: string; cueCount: number }) => cb(r)
    ipcRenderer.on('reprocess:done', handler)
    return () => ipcRenderer.removeListener('reprocess:done', handler)
  },
  onReprocessError: (cb: (e: { message: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, e: { message: string }) => cb(e)
    ipcRenderer.on('reprocess:error', handler)
    return () => ipcRenderer.removeListener('reprocess:error', handler)
  },

  // Scanner
  triggerScan: () => ipcRenderer.invoke('music:scan'),
  onScanProgress: (cb: (p: { done: number; total: number; current: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: { done: number; total: number; current: string }) => cb(p)
    ipcRenderer.on('scan:progress', handler)
    return () => ipcRenderer.removeListener('scan:progress', handler)
  },
  onScanComplete: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('scan:complete', handler)
    return () => ipcRenderer.removeListener('scan:complete', handler)
  },
  onMusicFolderChanged: (cb: (folder: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, folder: string) => cb(folder)
    ipcRenderer.on('music:folder-changed', handler)
    return () => ipcRenderer.removeListener('music:folder-changed', handler)
  },
  onSessionsChanged: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('sessions:changed', handler)
    return () => ipcRenderer.removeListener('sessions:changed', handler)
  },
  onSfxChanged: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('sfx:changed', handler)
    return () => ipcRenderer.removeListener('sfx:changed', handler)
  },

  // Tags
  getTags: (filename: string) => ipcRenderer.invoke('tags:get', filename),
  setTags: (filename: string, tags: string[]) => ipcRenderer.invoke('tags:set', filename, tags),
  getAllTags: () => ipcRenderer.invoke('tags:get-all'),
  getTagsMap: () => ipcRenderer.invoke('tags:get-map'),

  // Play History
  recordPlay: (itemId: string, itemType: 'music' | 'sfx') =>
    ipcRenderer.invoke('history:record-play', itemId, itemType),
  getPlayFrequencies: (itemType: 'music' | 'sfx') => ipcRenderer.invoke('history:get-frequencies', itemType),
  getTopPlayed: (itemType: 'music' | 'sfx', limit?: number) =>
    ipcRenderer.invoke('history:get-top-played', itemType, limit),

  // SFX
  getSfxList: () => ipcRenderer.invoke('sfx:list'),
  getSfxFolder: () => ipcRenderer.invoke('sfx:get-folder'),
  pickSfxFolder: () => ipcRenderer.invoke('sfx:pick-folder'),
  setSfxFolder: (path: string) => ipcRenderer.invoke('sfx:set-folder', path),
  getSfxRecommendationCount: () => ipcRenderer.invoke('settings:get-sfx-recommendation-count'),
  setSfxRecommendationCount: (count: number) => ipcRenderer.invoke('settings:set-sfx-recommendation-count', count),

  // Autopilot (#12)
  getAutopilotConfig: () => ipcRenderer.invoke('autopilot:get-config'),
  setAutopilotConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('autopilot:set-config', config),

  onSfxRecommendations: (cb: (ids: string[]) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, ids: string[]) => cb(ids)
    ipcRenderer.on('sfx:recommendations', handler)
    return () => ipcRenderer.removeListener('sfx:recommendations', handler)
  },

  // Discord
  discordConnect: (token?: string) => ipcRenderer.invoke('discord:connect', token),
  discordDisconnect: () => ipcRenderer.invoke('discord:disconnect'),
  discordGetState: () => ipcRenderer.invoke('discord:get-state'),
  discordGetGuilds: () => ipcRenderer.invoke('discord:get-guilds'),
  discordGetVoiceChannels: (guildId: string) => ipcRenderer.invoke('discord:get-voice-channels', guildId),
  discordJoinChannel: (guildId: string, channelId: string) =>
    ipcRenderer.invoke('discord:join-channel', guildId, channelId),
  discordLeaveChannel: () => ipcRenderer.invoke('discord:leave-channel'),
  discordStreamTrack: (filename: string, seekSeconds?: number) =>
    ipcRenderer.invoke('discord:stream-track', filename, seekSeconds),
  discordStreamSfx: (absolutePath: string, volume?: number) =>
    ipcRenderer.invoke('discord:stream-sfx', absolutePath, volume),
  discordStopStream: () => ipcRenderer.invoke('discord:stop-stream'),
  discordStopSfx: () => ipcRenderer.invoke('discord:stop-sfx'),
  discordPauseStream: () => ipcRenderer.invoke('discord:pause-stream'),
  discordResumeStream: () => ipcRenderer.invoke('discord:resume-stream'),
  discordSetVolume: (volume: number) => ipcRenderer.invoke('discord:set-volume', volume),
  discordGetVolume: () => ipcRenderer.invoke('discord:get-volume'),
  discordHasToken: () => ipcRenderer.invoke('discord:has-token'),
  discordClearToken: () => ipcRenderer.invoke('discord:clear-token'),
  discordGetAutoConnect: () => ipcRenderer.invoke('discord:get-auto-connect'),
  discordSetAutoConnect: (enabled: boolean) => ipcRenderer.invoke('discord:set-auto-connect', enabled),
  onDiscordState: (cb: (state: any) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, s: any) => cb(s)
    ipcRenderer.on('discord:state', handler)
    return () => ipcRenderer.removeListener('discord:state', handler)
  },
})
