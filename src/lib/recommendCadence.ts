/**
 * When a new transcript segment is worth a fresh recommendation.
 *
 * Every final segment used to re-run the ranker. At a real table that means a
 * model pass for "Né?", and a suggestion list that changes faster than anyone
 * can read it. Two gates fix that: something new has to have been said, and the
 * last answer has to be old enough to be stale.
 */

/** Filler and single-word interjections do not move a scene. */
export const MIN_NEW_WORDS = 3

/** Two seconds is faster than anyone reads the list, slower than the model. */
export const MIN_INTERVAL_MS = 2_000

export function shouldRecommend(wordsSinceLast: number, msSinceLast: number): boolean {
  return wordsSinceLast >= MIN_NEW_WORDS && msSinceLast >= MIN_INTERVAL_MS
}

/** How long to hold a request that arrived too soon; 0 means run it now. */
export function waitBeforeRecommending(msSinceLast: number): number {
  return Math.max(0, MIN_INTERVAL_MS - msSinceLast)
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Words spoken since the last ranking. A counter, not a buffer-length
 * difference: the window is trimmed, so a seeded session makes the difference
 * negative and no line ever ranks again.
 */
export function addSpokenWords(pending: number, line: string): number {
  return pending + countWords(line)
}
