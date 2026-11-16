/**
 * Language decisions: what the DM asked for, and what a spoken-language
 * identification justifies doing about it.
 *
 * The script guard in `stt-quality/script.ts` cannot tell English noise from
 * Portuguese speech in a roman alphabet; a LANGID model can label speech, but on
 * short utterances it is not trustworthy: measured with VoxLingua107 on real
 * Portuguese VAD segments, 5 of 25 were confidently labelled Albanian, Catalan,
 * Bulgarian or Galician (p >= 0.8). So the decisions below are the shape a
 * per-session preferred-language list needs, not something the live path acts
 * on yet — `test-results/stt-room.md` has the numbers and what would have to
 * change. Speech gating (`stt-quality/vad-gate.ts`) is what stops noise from
 * being decoded at all.
 */

/** Top-label probability a decision has to clear to be acted on. */
export const LANGID_CONFIDENCE = 0.75

export function resolveLanguage(requested: string | undefined, supported: string[]): string | undefined {
  if (!requested || requested === 'auto') return undefined
  if (supported.includes(requested)) return requested

  const base = requested.split('-')[0].toLowerCase()
  // Doty is pt-PT first: `pt` should mean Portugal, not Brazil.
  if (base === 'pt') {
    const ptPt = supported.find((l) => l.toLowerCase() === 'pt-pt')
    if (ptPt) return ptPt
  }
  return supported.find((l) => l.split('-')[0].toLowerCase() === base)
}

/** What a LANGID session reported, reduced to the decision's inputs. */
export interface LanguageGuess {
  /** Top label's code ("pt", "en"), or null when the model returned nothing. */
  code: string | null
  /** That label's probability over all labels. */
  probability: number
}

/**
 * Codes a session accepts, matched on the base code because LANGID labels are
 * two letters ("pt") while ASR models use locales ("pt-PT").
 *
 * `auto` accepts everything: with no preference stated there is nothing to
 * violate. A stored `sttPreferredLanguages` list would replace the single
 * setting here (see the report for the shared-file change).
 */
export function preferredCodes(setting: string | undefined): string[] {
  if (!setting || setting === 'auto') return []
  return [setting.split('-')[0].toLowerCase()]
}

/**
 * Whether a decoded segment contradicts the session's language. Not enabled in
 * the worker: on 1-4 s Portuguese segments this fires on real narration.
 */
export function rejectsLanguage(guess: LanguageGuess, preferred: string[]): boolean {
  if (preferred.length === 0) return false
  if (!guess.code || guess.probability < LANGID_CONFIDENCE) return false
  return !preferred.includes(guess.code.split('-')[0].toLowerCase())
}

/**
 * The language hint a decision on >=8 s of speech justifies, or undefined to let
 * the ASR model choose. Measured to change nothing for the shipped batch model
 * (Parakeet Ultra: same text and WER with and without a hint), so it is not
 * wired; it is the seam a model that does react to hints would use.
 */
export function hintFromLangId(guess: LanguageGuess, supported: string[]): string | undefined {
  if (!guess.code || guess.probability < LANGID_CONFIDENCE) return undefined
  return resolveLanguage(guess.code, supported)
}
