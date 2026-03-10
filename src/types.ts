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
  onRecommendations: (cb: (files: string[]) => void) => () => void

  // Model
  modelStatus: () => Promise<{ ready: boolean }>
  downloadModel: () => Promise<{ ok: boolean }>
  onModelProgress: (cb: (p: ProgressPayload) => void) => () => void
  onModelStatus: (cb: (s: { ready: boolean }) => void) => () => void

  // Transcripts
  getTranscriptFolder: () => Promise<string>
  pickTranscriptFolder: () => Promise<string | null>
  saveTranscript: (text: string) => Promise<{ ok: boolean; file?: string; reason?: string }>

  // Scanner
  triggerScan: () => Promise<{ ok: boolean }>
  onScanProgress: (cb: (p: ScanProgress) => void) => () => void
  onScanComplete: (cb: () => void) => () => void
}

declare global {
  interface Window {
    doty: DotyAPI
  }
}
