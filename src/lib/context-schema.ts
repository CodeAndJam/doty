import { Schema } from 'effect'

/**
 * The runtime shape of a context patch, shared by the IPC seam and the store.
 *
 * It lives beside `context.ts` rather than in it because that module is imported
 * by the renderer, and the schema pulls in Effect's runtime. Every field is
 * optional: the UI sends a patch, and `mergeContext` fills the rest.
 */
export const ContextConfigSchema = Schema.Struct({
  windowChars: Schema.optional(Schema.Number),
  rankerChars: Schema.optional(Schema.Number),
  sfxChars: Schema.optional(Schema.Number),
  hintChars: Schema.optional(Schema.Number),
  debounceMs: Schema.optional(Schema.Number),
})
