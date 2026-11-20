import fs from 'node:fs'
import { join } from 'node:path'
import { Option, Schema } from 'effect'
import { ContextConfigSchema } from '../src/lib/context-schema'
import { USER_DATA_DIR } from './profile'

/**
 * The DM's settings file. Every field is optional because a profile starts
 * empty, and each value is decoded against its own schema on load: one field of
 * the wrong type is dropped and reported, never the whole file. Before this, a
 * hand-edited file was read as `{}` and the next write replaced every key but
 * one.
 */
const FIELDS = {
  musicFolder: Schema.String,
  modelPath: Schema.String,
  transcriptFolder: Schema.String,
  recommendationCount: Schema.Number,
  /** What the models may read of the room: the DM's experiment surface. */
  context: Schema.optional(ContextConfigSchema),
  hotwordsFile: Schema.String,
  sfxFolder: Schema.String,
  sfxRecommendationCount: Schema.Number,
  // 'parakeet' | 'whisper-medium' | 'whisper-large-v3'
  sttModel: Schema.String,
  // 'auto' | 'pt' | 'en' | ... — avoids per-utterance language detection
  sttLanguage: Schema.String,
  // The DM chose to set up speech recognition later.
  sttOnboardingSkipped: Schema.Boolean,
  // Verbose logs to ~/.doty/logs/doty.log, for another Mac.
  debugMode: Schema.Boolean,
  // Encrypted via safeStorage, like the light token.
  discordToken: Schema.String,
  lightToken: Schema.String,
  lightUrl: Schema.String,
  lightArea: Schema.String,
  lightAuto: Schema.Boolean,
  // 0..1, independent of local volume
  discordVolume: Schema.Number,
  discordAutoConnect: Schema.Boolean,
  discordLastGuildId: Schema.String,
  discordLastChannelId: Schema.String,
  // local = DM mic only, all = plus Discord participants
  discordCaptureMode: Schema.Literals(['local', 'all']),
  // Post finished transcript lines into the channel's chat.
  discordTranscriptToChat: Schema.Boolean,
  lastSession: Schema.String,
  // The master switch is on the header and off by default; the per-channel
  // switches sit under it and only matter while it is on.
  autopilotEnabled: Schema.Boolean,
  autopilotMusicEnabled: Schema.Boolean,
  autopilotSfxEnabled: Schema.Boolean,
  autopilotConfidenceThreshold: Schema.Number,
  autopilotCrossfadeDuration: Schema.Number,
  autopilotMusicCooldown: Schema.Number,
  autopilotMinPlaySeconds: Schema.Number,
  autopilotSfxPerEffectCooldown: Schema.Number,
  autopilotSfxGlobalCooldown: Schema.Number,
  autopilotSfxAutoVolume: Schema.Number,
  autopilotRecentlyPlayedMinutes: Schema.Number,
} as const

type StoreData = { [K in keyof typeof FIELDS]?: Schema.Schema.Type<(typeof FIELDS)[K]> }

const FIELDS_BY_KEY = FIELDS as unknown as Record<string, Schema.ConstraintDecoder<unknown>>

const storePath = join(USER_DATA_DIR, 'config.json')

/** Set when the file exists but cannot be read or parsed: never overwrite it. */
let unreadable = false

function decodeKey<K extends keyof StoreData>(key: K, value: unknown): StoreData[K] | undefined {
  if (value === undefined) return undefined
  return Option.getOrUndefined(Schema.decodeUnknownOption(FIELDS_BY_KEY[key])(value)) as StoreData[K] | undefined
}

/** Keep the bytes the DM can still recover by hand, and only the newest copy. */
function quarantine(reason: unknown): void {
  const backup = `${storePath}.corrupt-${Date.now()}`
  try {
    fs.renameSync(storePath, backup)
    // The config holds the encrypted Discord and Home Assistant tokens.
    fs.chmodSync(backup, 0o600)
    const dir = join(storePath, '..')
    const older = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith('config.json.corrupt-'))
      .sort()
    for (const name of older.slice(0, -1)) fs.rmSync(join(dir, name), { force: true })
  } catch {
    // The file is unreadable and unmovable. Refusing to write is the only way
    // to keep the next `set` from truncating it.
    unreadable = true
  }
  console.error(`[store] config could not be read; kept it as ${backup}`, reason)
}

function load(): StoreData {
  let raw: string
  try {
    raw = fs.readFileSync(storePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    quarantine(err)
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    quarantine(err)
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    quarantine(new Error('config is not an object'))
    return {}
  }

  const source = parsed as Record<string, unknown>
  const data: Record<string, unknown> = {}
  const ignored: string[] = []
  for (const key of Object.keys(FIELDS) as Array<keyof StoreData>) {
    const value = decodeKey(key, source[key])
    if (value !== undefined) data[key] = value
    else if (source[key] !== undefined) ignored.push(key)
  }
  if (ignored.length > 0) {
    console.warn(`[store] ignored settings with the wrong type: ${ignored.join(', ')}`)
  }
  // Keep keys this build does not know: a downgrade must not erase a newer
  // release's settings on the first write.
  for (const [key, value] of Object.entries(source)) {
    if (!(key in FIELDS)) data[key] = value
  }
  return data as StoreData
}

/**
 * One copy in memory, invalidated only by this module's own `set`. The profile
 * is single-instance by contract (`acquireProfileLock`), so a second writer of
 * `config.json` is not a case to handle.
 */
let cache: StoreData | null = null
const read = (): StoreData => (cache ??= load())

function write(data: StoreData): void {
  fs.mkdirSync(join(storePath, '..'), { recursive: true })
  // Atomic replace: a crash mid-write must not truncate the existing config.
  const tmpPath = `${storePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 })
  // `mode` only applies to a new file: a temp left by an older build is 0644 and
  // the rename would carry that onto the config.
  fs.chmodSync(tmpPath, 0o600)
  fs.renameSync(tmpPath, storePath)
}

export const store = {
  get<K extends keyof StoreData>(key: K, fallback: NonNullable<StoreData[K]>): NonNullable<StoreData[K]> {
    return (read()[key] ?? fallback) as NonNullable<StoreData[K]>
  },
  set<K extends keyof StoreData>(key: K, value: StoreData[K]): void {
    if (unreadable) {
      console.error(`[store] refusing to overwrite an unreadable config (dropped ${String(key)})`)
      return
    }
    const next = { ...read(), [key]: value }
    // Disk first: a failed write must not leave memory claiming the value.
    write(next)
    cache = next
  },
}
