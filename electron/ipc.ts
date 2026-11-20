/**
 * Every renderer <-> main channel, declared once.
 *
 * preload.ts and main.ts reference these names, so a channel cannot be
 * half-wired: an undeclared name fails to typecheck, and ipc.test.ts rejects
 * raw channel strings in either process.
 *
 * The same file owns each channel's argument shape (`ARGS`), because a name
 * alone was half a contract: preload, the renderer's `DotyAPI` and the handler
 * each re-declared the payload by hand, and a drift between them was silent.
 */

import { Schema } from 'effect'

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

// ── Argument shapes ──────────────────────────────────────────────────────────
// One row per channel that takes arguments, in call order. This is the only
// declaration of an argument shape: `preload.ts` decodes through it, `main.ts`
// decodes through it at `handle`, and both derive their parameter types from
// it. A handler that drifts from its row stops compiling.

const Lane = Schema.Literals(['music', 'sfx'])
const Maybe = <A>(schema: Schema.Schema<A>) => Schema.optional(Schema.NullOr(schema))

/** A track patch, as the lights panel writes it. */
const LightPatchSchema = Schema.Struct({
  on: Schema.optional(Schema.Boolean),
  brightnessPct: Schema.optional(Schema.Number),
  rgb: Schema.optional(Schema.mutable(Schema.Tuple([Schema.Number, Schema.Number, Schema.Number]))),
  effect: Schema.optional(Schema.String),
})

/** What the renderer sends for one session pass. Mirrors `PassRequest`. */
const SessionPassSchema = Schema.Struct({
  state: Schema.String,
  candidates: Schema.mutable(Schema.Array(Schema.String)),
  paths: Schema.mutable(Schema.Array(Schema.String)),
  msUntilTrackEnd: Schema.NullOr(Schema.Number),
  musicEnabled: Schema.Boolean,
  confidenceThreshold: Schema.optional(Schema.Number),
})

/** A decision the renderer executed. Mirrors `DecisionRow`. */
const DecisionRowSchema = Schema.Struct({
  at: Schema.Number,
  kind: Schema.String,
  action: Schema.String,
  reason: Schema.String,
  track: Schema.NullOr(Schema.String),
  probability: Schema.Number,
  mood: Schema.NullOr(Schema.String),
  source: Schema.Literals(['auto', 'manual', 'hint']),
})

/** A pick or a rejection. Mirrors `PreferenceRow`. */
const PreferenceRowSchema = Schema.Struct({
  at: Schema.Number,
  segment: Schema.String,
  track: Schema.String,
  scene: Schema.NullOr(Schema.String),
  source: Schema.Literals(['auto', 'manual', 'reject']),
})

/** The decoded shapes a caller hands back to main, named for preload. */
export type DecisionInput = Schema.Schema.Type<typeof DecisionRowSchema>
export type PreferenceInput = Schema.Schema.Type<typeof PreferenceRowSchema>

export const ARGS = {
  [INVOKE.sttTranscribeChunk]: Schema.Tuple([Schema.instanceOf(ArrayBuffer)]),
  [INVOKE.moveTrack]: Schema.Tuple([Schema.String, Lane]),
  [INVOKE.setLane]: Schema.Tuple([Schema.String, Lane]),
  [INVOKE.setMusicFolder]: Schema.Tuple([Schema.String]),
  [INVOKE.getTags]: Schema.Tuple([Schema.String]),
  [INVOKE.setTags]: Schema.Tuple([Schema.String, Schema.mutable(Schema.Array(Schema.String))]),
  [INVOKE.recordPlay]: Schema.Tuple([Schema.String, Lane]),
  [INVOKE.getPlayFrequencies]: Schema.Tuple([Lane]),
  [INVOKE.getTopPlayed]: Schema.Tuple([Lane, Schema.optional(Schema.Number)]),
  [INVOKE.saveTranscript]: Schema.Tuple([Schema.String]),
  [INVOKE.sessionCreate]: Schema.Tuple([Schema.optional(Schema.String)]),
  [INVOKE.sessionLoad]: Schema.Tuple([Schema.String]),
  [INVOKE.sessionSetActive]: Schema.Tuple([Schema.String]),
  [INVOKE.sessionRename]: Schema.Tuple([Schema.String, Schema.String]),
  [INVOKE.sessionDelete]: Schema.Tuple([Schema.String]),
  [INVOKE.reprocessStart]: Schema.Tuple([Schema.String, Schema.String]),
  [INVOKE.lightsGetState]: Schema.Tuple([Maybe(Schema.String)]),
  [INVOKE.lightsConfigure]: Schema.Tuple([
    Schema.Struct({ url: Schema.String, token: Schema.optional(Schema.String) }),
  ]),
  [INVOKE.lightsSetArea]: Schema.Tuple([Schema.NullOr(Schema.String), Schema.String]),
  [INVOKE.lightsSetAuto]: Schema.Tuple([Schema.Boolean]),
  [INVOKE.lightsSetPower]: Schema.Tuple([Schema.Boolean]),
  [INVOKE.lightsSetBrightness]: Schema.Tuple([Schema.Number]),
  [INVOKE.lightsSetLight]: Schema.Tuple([Schema.String, LightPatchSchema]),
  [INVOKE.lightsSetPulse]: Schema.Tuple([Schema.Boolean]),
  [INVOKE.lightsSetMood]: Schema.Tuple([Schema.String]),
  [INVOKE.lightsSetHint]: Schema.Tuple([Schema.NullOr(Schema.String), Schema.String]),
  [INVOKE.sessionEvaluate]: Schema.Tuple([SessionPassSchema]),
  [INVOKE.sessionDecision]: Schema.Tuple([DecisionRowSchema]),
  [INVOKE.sessionPreference]: Schema.Tuple([PreferenceRowSchema]),
  [INVOKE.sessionReport]: Schema.Tuple([Schema.Number]),
  [INVOKE.sfxRank]: Schema.Tuple([Schema.String, Schema.mutable(Schema.Array(Schema.String))]),
  [INVOKE.librarySearch]: Schema.Tuple([Schema.String, Lane, Schema.Number]),
  [INVOKE.rankerDecide]: Schema.Tuple([Schema.String, Schema.mutable(Schema.Array(Schema.String))]),
  [INVOKE.setRecommendationCount]: Schema.Tuple([Schema.Number]),
  [INVOKE.downloadModel]: Schema.Tuple([Schema.optional(Schema.String)]),
  [INVOKE.setSttModel]: Schema.Tuple([Schema.String]),
  [INVOKE.setSttLanguage]: Schema.Tuple([Schema.String]),
  [INVOKE.discordConnect]: Schema.Tuple([Schema.optional(Schema.String)]),
  [INVOKE.discordGetVoiceChannels]: Schema.Tuple([Schema.String]),
  [INVOKE.discordJoinChannel]: Schema.Tuple([Schema.String, Schema.String]),
  [INVOKE.discordStreamTrack]: Schema.Tuple([Schema.String, Schema.optional(Schema.Number)]),
  [INVOKE.discordStreamSfx]: Schema.Tuple([Schema.String, Schema.optional(Schema.Number)]),
  [INVOKE.discordStopSfx]: Schema.Tuple([Schema.optional(Schema.String)]),
  [INVOKE.discordSetVolume]: Schema.Tuple([Schema.Number]),
  [INVOKE.discordSetAutoConnect]: Schema.Tuple([Schema.Boolean]),
  [INVOKE.discordSetCaptureMode]: Schema.Tuple([Schema.Literals(['local', 'all'])]),
  [INVOKE.discordSetSendTranscript]: Schema.Tuple([Schema.Boolean]),
  [INVOKE.setSfxFolder]: Schema.Tuple([Schema.String]),
  [INVOKE.setSfxRecommendationCount]: Schema.Tuple([Schema.Number]),
  [INVOKE.setAutopilotConfig]: Schema.Tuple([Schema.Record(Schema.String, Schema.Unknown)]),
  [INVOKE.deleteModel]: Schema.Tuple([Schema.Literals(['stt', 'ranker', 'embedder']), Schema.optional(Schema.String)]),
  [INVOKE.debugSetEnabled]: Schema.Tuple([Schema.Boolean]),
}

/** The positional arguments a channel takes, derived from its `ARGS` row. */
export type InvokeArgs<C extends InvokeChannel> = C extends keyof typeof ARGS
  ? Schema.Schema.Type<(typeof ARGS)[C]>
  : []

/**
 * Decode a renderer call at the seam. A malformed payload rejects the invoke
 * instead of reaching a handler as `undefined`.
 */
export function decodeArgs<C extends InvokeChannel>(channel: C, raw: unknown[]): InvokeArgs<C> {
  const schema = (ARGS as unknown as Record<string, Schema.ConstraintDecoder<unknown>>)[channel]
  if (!schema) return raw as InvokeArgs<C>
  return Schema.decodeUnknownSync(schema)(raw) as InvokeArgs<C>
}
