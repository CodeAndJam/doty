/**
 * The pick the DM sees holds unless the model's next answer is clearly better.
 *
 * A few points of probability between two tracks is not a change of scene, but
 * swapping the top card on it makes the model look like it keeps changing its
 * mind while the DM types. Same rule as the director: the challenger must be
 * ahead by a real margin, not by noise.
 */
/** The director's boundary ratio; the same "clearly ahead" rule on this side. */
const STABLE_TOP_RATIO = 1.5

export function stableOrder(
  next: string[],
  probabilities: Record<string, number>,
  previousTop: string | null,
): string[] {
  if (!previousTop || next.length < 2 || next[0] === previousTop) return next
  if (!next.includes(previousTop)) return next

  const challenger = probabilities[next[0]] ?? 0
  const held = probabilities[previousTop] ?? 0
  // Keyword answers carry no calibrated probability; comparing zeros would pin
  // the shelf to a track the new words no longer describe.
  if (challenger <= 0 || held <= 0) return next
  if (challenger >= held * STABLE_TOP_RATIO) return next

  return [previousTop, ...next.filter((file) => file !== previousTop)]
}
