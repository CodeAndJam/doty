/**
 * Scoring shared by the music and SFX heuristics. Each function owns one weight,
 * so the two recommendation paths cannot drift apart.
 */
import { matchesTag, tokenize } from './keywordMatch'

/** Share of the candidate's own words the prompt mentions, doubled and capped at 1. */
export function textOverlap(text: string, tokens: string[]): number {
  const textTokens = tokenize(text)
  const matches = textTokens.filter((t) => tokens.includes(t)).length
  return Math.min(1, (matches / Math.max(1, textTokens.length)) * 2)
}

/** User tags the prompt matches, weighted 3x: explicit intent beats filenames. */
export function tagMatch(tags: string[], tokens: string[]): number {
  const matches = tags.filter((tag) => matchesTag(tokens, tag)).length
  return Math.min(1, matches / Math.max(1, tags.length)) * 3
}

/** Half of the normalised play count: a nudge towards tracks the table already likes. */
export function historyBoost(plays: number, max: number): number {
  return (plays / Math.max(1, max)) * 0.5
}

/** Highest play count in the history, floored at 1 so division is always safe. */
export function maxPlays(playFrequencies: Record<string, number>): number {
  return Math.max(1, ...Object.values(playFrequencies))
}
