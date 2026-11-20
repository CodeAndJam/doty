import fs from 'node:fs'
import { join } from 'node:path'
import { Schema } from 'effect'
import { USER_DATA_DIR } from './profile'

/**
 * The DM's settings file. Every field is optional because a profile starts
 * empty, but the file as a whole is decoded: a config that cannot be read is a
 * recoverable failure, not an empty config. Before this, a hand-edited or
 * truncated file was silently read as `{}` and the next write replaced every
 * key but one.
 */
const StoreData = Schema.Struct({
  musicFolder: Schema.optional(Schema.String),
  modelPath: Schema.optional(Schema.String),
  transcriptFolder: Schema.optional(Schema.String),
  recommendationCount: Schema.optional(Schema.Number),
  hotwordsFile: Schema.optional(Schema.String),
  sfxFolder: Schema.optional(Schema.String),
  sfxRecommendationCount: Schema.optional(Schema.Number),
  // 'parakeet' | 'whisper-medium' | 'whisper-large-v3'
  sttModel: Schema.optional(Schema.String),
  // 'auto' | 'pt' | 'en' | ... — avoids per-utterance language detection
  sttLanguage: Schema.optional(Schema.String),
  // The DM chose to set up speech recognition later.
  sttOnboardingSkipped: Schema.optional(Schema.Boolean),
  // Verbose logs to ~/.doty/logs/doty.log, for another Mac.
  debugMode: Schema.optional(Schema.Boolean),
  // Encrypted via safeStorage, like the light token.
  discordToken: Schema.optional(Schema.String),
  lightToken: Schema.optional(Schema.String),
  lightUrl: Schema.optional(Schema.String),
  lightArea: Schema.optional(Schema.String),
  lightAuto: Schema.optional(Schema.Boolean),
  // 0..1, independent of local volume
  discordVolume: Schema.optional(Schema.Number),
  discordAutoConnect: Schema.optional(Schema.Boolean),
  discordLastGuildId: Schema.optional(Schema.String),
  discordLastChannelId: Schema.optional(Schema.String),
  // local = DM mic only, all = plus Discord participants
  discordCaptureMode: Schema.optional(Schema.Literals(['local', 'all'])),
  // Post finished transcript lines into the channel's chat.
  discordTranscriptToChat: Schema.optional(Schema.Boolean),
  lastSession: Schema.optional(Schema.String),
  // The master switch is on the header and off by default; the per-channel
  // switches sit under it and only matter while it is on.
  autopilotEnabled: Schema.optional(Schema.Boolean),
  autopilotMusicEnabled: Schema.optional(Schema.Boolean),
  autopilotSfxEnabled: Schema.optional(Schema.Boolean),
  autopilotConfidenceThreshold: Schema.optional(Schema.Number),
  autopilotCrossfadeDuration: Schema.optional(Schema.Number),
  autopilotMusicCooldown: Schema.optional(Schema.Number),
  autopilotMinPlaySeconds: Schema.optional(Schema.Number),
  autopilotSfxPerEffectCooldown: Schema.optional(Schema.Number),
  autopilotSfxGlobalCooldown: Schema.optional(Schema.Number),
  autopilotSfxAutoVolume: Schema.optional(Schema.Number),
  autopilotRecentlyPlayedMinutes: Schema.optional(Schema.Number),
})

type StoreData = typeof StoreData.Type

const decode = Schema.decodeUnknownSync(StoreData)

const storePath = join(USER_DATA_DIR, 'config.json')

function load(): StoreData {
  try {
    const raw = fs.readFileSync(storePath, 'utf-8')
    // Unknown keys (a newer build's settings) are ignored, not fatal.
    return decode(JSON.parse(raw), { onExcessProperty: 'ignore' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    // Keep the bytes the DM can still recover by hand, then start fresh. The
    // alternative — treating it as `{}` — loses every setting on the next write.
    const backup = `${storePath}.corrupt-${Date.now()}`
    try {
      fs.renameSync(storePath, backup)
    } catch {
      // The file is unreadable and unmovable; the log line is the only report.
    }
    console.error(`[store] config could not be read; kept it as ${backup}`, err)
    return {}
  }
}

/** One copy in memory: every `get` used to re-read and re-parse the file. */
let cache: StoreData | null = null
const read = (): StoreData => (cache ??= load())

function write(data: StoreData): void {
  fs.mkdirSync(join(storePath, '..'), { recursive: true })
  // Atomic replace: a crash mid-write must not truncate the existing config.
  const tmpPath = `${storePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2))
  fs.renameSync(tmpPath, storePath)
}

export const store = {
  get<K extends keyof StoreData>(key: K, fallback: NonNullable<StoreData[K]>): NonNullable<StoreData[K]> {
    return (read()[key] ?? fallback) as NonNullable<StoreData[K]>
  },
  set<K extends keyof StoreData>(key: K, value: StoreData[K]): void {
    const next = { ...read(), [key]: value }
    cache = next
    write(next)
  },
}
