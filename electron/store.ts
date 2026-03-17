import fs from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

interface StoreData {
  musicFolder?: string
  modelPath?: string
  transcriptFolder?: string
  recommendationCount?: number
  hotwordsFile?: string
  sfxFolder?: string
  sfxRecommendationCount?: number
  sttModel?: string // 'parakeet' | 'whisper-medium' | 'whisper-large-v3'
  discordToken?: string // encrypted via safeStorage
  discordVolume?: number // 0..1, independent of local volume
  discordAutoConnect?: boolean // auto-connect to last channel on startup
  discordLastGuildId?: string // last joined guild
  discordLastChannelId?: string // last joined channel
  // Autopilot (#12)
  autopilotEnabled?: boolean
  autopilotMusicEnabled?: boolean
  autopilotSfxEnabled?: boolean
  autopilotConfidenceThreshold?: number // 0.0-1.0
  autopilotCrossfadeDuration?: number // seconds
  autopilotMusicCooldown?: number // seconds
  autopilotMinPlaySeconds?: number // seconds
  autopilotSfxPerEffectCooldown?: number // seconds
  autopilotSfxGlobalCooldown?: number // seconds
  autopilotSfxAutoVolume?: number // 0.0-1.0
}

const storePath = join(app.getPath('userData'), 'config.json')

function read(): StoreData {
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf-8'))
  } catch {
    return {}
  }
}

function write(data: StoreData): void {
  fs.mkdirSync(join(storePath, '..'), { recursive: true })
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2))
}

export const store = {
  get<K extends keyof StoreData>(key: K, fallback: StoreData[K]): StoreData[K] {
    return read()[key] ?? fallback
  },
  set<K extends keyof StoreData>(key: K, value: StoreData[K]): void {
    write({ ...read(), [key]: value })
  },
}
