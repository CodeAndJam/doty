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

/**
 * Function words that name nothing, in both languages the DM types.
 *
 * Without this list an article in a filename reads as a match: `The Dark
 * Forest` looked named by the prompt "the", which turned the energy fallback
 * off for every track with an article in its name.
 */
const STOPWORDS = new Set([
  // en
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'do',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'here',
  'his',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'its',
  'me',
  'my',
  'no',
  'not',
  'of',
  'on',
  'or',
  'our',
  'she',
  'so',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'they',
  'this',
  'to',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'you',
  'your',
  // pt
  'ao',
  'aos',
  'aquela',
  'aquele',
  'as',
  'ate',
  'com',
  'como',
  'da',
  'das',
  'de',
  'dela',
  'dele',
  'depois',
  'do',
  'dos',
  'e',
  'ela',
  'ele',
  'eles',
  'em',
  'entre',
  'era',
  'essa',
  'esse',
  'esta',
  'este',
  'eu',
  'foi',
  'ja',
  'mais',
  'mas',
  'muito',
  'na',
  'nao',
  'nas',
  'no',
  'nos',
  'o',
  'os',
  'ou',
  'para',
  'pela',
  'pelo',
  'por',
  'que',
  'se',
  'sem',
  'ser',
  'seu',
  'sua',
  'tem',
  'um',
  'uma',
])

/**
 * How much a prompt the candidate's own name or label carries.
 *
 * A hit is worth 1 before the overlap: the analysis feature score tops out at
 * 1, so a track whose name carries the word the DM typed is never beaten by
 * one the analyser merely liked. Stopwords never count as a hit, and they are
 * left out of the overlap, or "the" would be a match in half the library.
 */
export function nameMatch(name: string, tokens: string[]): number {
  const prompt = tokens.filter((token) => !STOPWORDS.has(token))
  const words = tokenize(name).filter((word) => !STOPWORDS.has(word))
  const hits = words.filter((word) => prompt.includes(word)).length
  const overlap = Math.min(1, (hits / Math.max(1, words.length)) * 2)
  return (hits > 0 ? 1 : 0) + overlap * 2
}

/** Half of the normalised play count: a nudge towards tracks the table already likes. */
export function historyBoost(plays: number, max: number): number {
  return (plays / Math.max(1, max)) * 0.5
}

/** Highest play count in the history, floored at 1 so division is always safe. */
export function maxPlays(playFrequencies: Record<string, number>): number {
  return Math.max(1, ...Object.values(playFrequencies))
}
