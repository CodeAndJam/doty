/**
 * Roughly what the model's fixed 1024-token row can hold for the state once the
 * option block is in it. Past this the extra characters are tokenized and
 * dropped, so the budget stops being honest.
 */
export const MODEL_STATE_CHARS = 1400

/**
 * What the decision models are allowed to read. The DM tunes these to see what
 * changes a pick; every value is a character or millisecond budget, never a
 * scoring rule.
 */
export interface ContextConfig {
  /** Chars kept in the live transcript buffer. */
  windowChars: number
  /** Chars of that buffer sent to the music ranker. */
  rankerChars: number
  /** Chars of that buffer sent to the effects ranker. */
  sfxChars: number
  /** Chars of the DM's Session Hint sent to the models. */
  hintChars: number
  /** Ms between a transcript line and the ranking it triggers. */
  debounceMs: number
}

export const DEFAULT_CONTEXT: ContextConfig = {
  windowChars: 800,
  rankerChars: 500,
  sfxChars: 500,
  hintChars: 300,
  debounceMs: 1500,
}

/** Below these a model sees nothing usable; above MODEL_STATE_CHARS the row drops it. */
export const CONTEXT_LIMITS: Record<keyof ContextConfig, [number, number]> = {
  windowChars: [200, 8000],
  rankerChars: [100, MODEL_STATE_CHARS],
  sfxChars: [100, MODEL_STATE_CHARS],
  hintChars: [0, MODEL_STATE_CHARS],
  debounceMs: [250, 10000],
}

/** Every field valid, whatever was stored or typed. Main writes only this. */
export function normalizeContext(value: Partial<ContextConfig> | undefined): ContextConfig {
  const out = { ...DEFAULT_CONTEXT }
  for (const key of Object.keys(CONTEXT_LIMITS) as Array<keyof ContextConfig>) {
    const raw = value?.[key]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    const [min, max] = CONTEXT_LIMITS[key]
    out[key] = Math.round(Math.min(max, Math.max(min, raw)))
  }
  return out
}

/** Merge a patch the way main does, so the panel cannot show a value the store refuses. */
export function mergeContext(stored: Partial<ContextConfig>, patch: Partial<ContextConfig>): ContextConfig {
  return normalizeContext({ ...stored, ...patch })
}

/**
 * The hint first, then the recent words: the DM's instruction is the head of
 * the state, and the transcript is what it is about. When the two exceed what
 * the model can read, the transcript gives way — never the hint.
 */
export function composeState(
  hint: string,
  transcript: string,
  budget: { hintChars: number; transcriptChars: number },
): string {
  // A zero budget is nothing; `slice(-0)` would hand over the whole string.
  const hintLimit = Math.min(budget.hintChars, MODEL_STATE_CHARS)
  const instruction = hintLimit > 0 ? hint.slice(0, hintLimit).trim() : ''
  const room = Math.max(0, MODEL_STATE_CHARS - (instruction ? instruction.length + 1 : 0))
  const chars = Math.min(budget.transcriptChars, room)
  const words = chars > 0 ? transcript.slice(-chars).trim() : ''
  return [instruction, words].filter(Boolean).join('\n')
}

/** The window a session's cues seed: the room's most recent words, within the DM's budget. */
export function seedWindow(texts: string[], windowChars: number): string {
  return texts.filter(Boolean).join(' ').slice(-windowChars)
}

/**
 * What the effects embedder reads: the hint heads the state and the newest words
 * end it, so both ends are kept. The middle is what a per-line embedder cannot
 * afford to pay for.
 */
export function embedQuery(text: string): string {
  return text.length > 400 ? `${text.slice(0, 100)} ${text.slice(-300)}` : text
}
