/**
 * The argument half of the IPC contract: one row per channel, in call order.
 *
 * It lives beside `ipc.ts` rather than inside it because `ipc.ts` is imported by
 * the preload bundle, and the schemas pull in Effect's runtime. `preload.ts`
 * imports only the derived types from here, which erase at build time, so the
 * 58 MB package never lands in a 21 KB preload.
 *
 * This is still the only declaration of an argument shape: `preload.ts` derives
 * its parameters, `main.ts` decodes through it at `handle`, and a handler that
 * drifts from its row stops compiling.
 */
import { Schema } from 'effect'
import { INVOKE, type InvokeChannel } from './ipc'

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
