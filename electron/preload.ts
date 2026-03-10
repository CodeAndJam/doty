import { contextBridge, ipcRenderer } from 'electron'

export type ProgressPayload = { percent: number; downloadedMB: number; totalMB: number }

contextBridge.exposeInMainWorld('doty', {
  // STT
  sttStart: () => ipcRenderer.invoke('stt:start'),
  sttStop: () => ipcRenderer.invoke('stt:stop'),
  sttTranscribeChunk: (buffer: ArrayBuffer) => ipcRenderer.invoke('stt:transcribe-chunk', buffer),
  onTranscript: (cb: (text: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, text: string) => cb(text)
    ipcRenderer.on('stt:transcript', handler)
    return () => ipcRenderer.removeListener('stt:transcript', handler)
  },

  // Music
  pickMusicFolder: () => ipcRenderer.invoke('music:pick-folder'),
  getMusicFolder: () => ipcRenderer.invoke('music:get-folder'),
  setMusicFolder: (path: string) => ipcRenderer.invoke('music:set-folder', path),
  listMusic: () => ipcRenderer.invoke('music:list'),
  getAllMetadata: () => ipcRenderer.invoke('music:get-all-metadata'),
  recommendManual: (prompt: string) => ipcRenderer.invoke('music:recommend-manual', prompt),
  onRecommendations: (cb: (files: string[]) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, files: string[]) => cb(files)
    ipcRenderer.on('music:recommendations', handler)
    return () => ipcRenderer.removeListener('music:recommendations', handler)
  },

  // Model
  modelStatus: () => ipcRenderer.invoke('model:status'),
  downloadModel: () => ipcRenderer.invoke('model:download'),
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

  // Transcripts
  getTranscriptFolder: () => ipcRenderer.invoke('transcript:get-folder'),
  pickTranscriptFolder: () => ipcRenderer.invoke('transcript:pick-folder'),
  saveTranscript: (text: string) => ipcRenderer.invoke('transcript:save', text),

  // Qwen recommendation model status
  onQwenStatus: (cb: (s: { status: 'loading' | 'ready' }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, s: { status: 'loading' | 'ready' }) => cb(s)
    ipcRenderer.on('qwen:status', handler)
    return () => ipcRenderer.removeListener('qwen:status', handler)
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
})
