/**
 * heuristicSfxRecommend.ts
 * Keyword + category scoring for SFX recommendations.
 * Runs synchronously in the renderer — no ML required.
 *
 * Scoring dimensions:
 *   - Label keyword match against transcript tokens
 *   - Category match via mood profiles
 *   - Description keyword overlap
 *   - User tag match (weighted highest — explicit intent)
 */

import type { SfxMeta } from '../types'

interface SfxMoodProfile {
  keywords: string[]
  categories: string[]
}

const SFX_MOOD_PROFILES: SfxMoodProfile[] = [
  {
    keywords: [
      'battle',
      'combat',
      'fight',
      'war',
      'clash',
      'attack',
      'assault',
      'sword',
      'weapon',
      'hit',
      'strike',
      'slash',
      'arrow',
      'shield',
      'armor',
      'boss',
    ],
    categories: ['combat'],
  },
  {
    keywords: ['fire', 'flame', 'torch', 'burn', 'campfire', 'bonfire', 'lava', 'inferno', 'ember', 'heat'],
    categories: ['fire'],
  },
  {
    keywords: [
      'rain',
      'storm',
      'thunder',
      'lightning',
      'wind',
      'snow',
      'blizzard',
      'weather',
      'ocean',
      'sea',
      'river',
      'water',
      'wave',
      'creek',
      'forest',
      'bird',
      'nature',
      'animal',
      'wolf',
      'howl',
    ],
    categories: ['nature'],
  },
  {
    keywords: [
      'walk',
      'run',
      'step',
      'footstep',
      'march',
      'horse',
      'gallop',
      'travel',
      'journey',
      'road',
      'path',
      'chase',
      'flee',
      'escape',
    ],
    categories: ['footsteps'],
  },
  {
    keywords: [
      'door',
      'gate',
      'lock',
      'key',
      'chest',
      'open',
      'close',
      'creak',
      'mechanism',
      'lever',
      'trap',
      'chain',
      'portcullis',
    ],
    categories: ['doors'],
  },
  {
    keywords: [
      'tavern',
      'inn',
      'crowd',
      'cheer',
      'drink',
      'mug',
      'laugh',
      'music',
      'bard',
      'feast',
      'celebration',
      'village',
      'market',
      'town',
    ],
    categories: ['tavern'],
  },
  {
    keywords: [
      'horror',
      'dark',
      'spooky',
      'haunted',
      'ghost',
      'undead',
      'scream',
      'whisper',
      'creepy',
      'cemetery',
      'crypt',
      'zombie',
      'skeleton',
      'vampire',
      'shadow',
    ],
    categories: ['horror'],
  },
  {
    keywords: [
      'magic',
      'spell',
      'cast',
      'arcane',
      'enchant',
      'wizard',
      'sorcerer',
      'potion',
      'heal',
      'fireball',
      'lightning bolt',
      'teleport',
      'summon',
      'ritual',
      'rune',
      'crystal',
      'divine',
      'holy',
    ],
    categories: ['magic'],
  },
  {
    keywords: [
      'cave',
      'dungeon',
      'underground',
      'echo',
      'drip',
      'ambient',
      'atmosphere',
      'city',
      'swamp',
      'desert',
      'mountain',
      'temple',
      'ruin',
      'church',
      'cathedral',
    ],
    categories: ['environment'],
  },
]

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Detect which mood profiles match the transcript */
function detectMoods(tokens: string[]): SfxMoodProfile[] {
  return SFX_MOOD_PROFILES.map((p) => ({ profile: p, score: p.keywords.filter((k) => tokens.includes(k)).length }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((p) => p.profile)
}

/** Score a label/description against transcript tokens */
function textScore(text: string, tokens: string[]): number {
  const textTokens = tokenize(text)
  const matches = textTokens.filter((t) => tokens.includes(t)).length
  return Math.min(1, (matches / Math.max(1, textTokens.length)) * 2)
}

export function heuristicSfxRecommend(
  transcript: string,
  sfxList: SfxMeta[],
  count = 5,
  tagsMap: Record<string, string[]> = {},
  playFrequencies: Record<string, number> = {},
): string[] {
  if (sfxList.length === 0) return []

  const tokens = tokenize(transcript)

  // If no tokens (empty prompt/transcript), return most-played SFX or a random sample
  if (tokens.length === 0) {
    return defaultSfxRecommendations(sfxList, playFrequencies, count)
  }

  const moods = detectMoods(tokens)
  const matchedCategories = new Set(moods.flatMap((m) => m.categories))

  // Compute max play count for normalization
  const maxPlays = Math.max(1, ...Object.values(playFrequencies))

  const scored = sfxList.map((sfx) => {
    // Label match (weighted 2x)
    const labelScore = textScore(sfx.label, tokens) * 2

    // Description match (weighted 1x)
    const descScore = textScore(sfx.description, tokens)

    // Category match (weighted 2x) — binary: is this SFX's category in the detected moods?
    const catScore = matchedCategories.has(sfx.category) ? 2 : 0

    // Filename/label category inference (weighted 1.5x) — check if the SFX label
    // contains any keyword from the matched mood profiles, even if the directory
    // structure doesn't match the expected category names
    const labelTokens = tokenize(sfx.label)
    const allMoodKeywords = moods.flatMap((m) => m.keywords)
    const labelMoodMatch =
      labelTokens.some((t) => allMoodKeywords.includes(t)) ||
      allMoodKeywords.some((k) => labelTokens.some((t) => t.includes(k) || k.includes(t)))
    const labelMoodScore = labelMoodMatch ? 1.5 : 0

    // Tag score (weighted 3x — user intent is explicit)
    const sfxTags = tagsMap[sfx.filename] || []
    const tagMatches = sfxTags.filter((tag) => tokens.some((t) => tag.includes(t) || t.includes(tag))).length
    const tagScore = Math.min(1, tagMatches / Math.max(1, sfxTags.length)) * 3

    // History boost: frequently played SFX get a small bonus (weighted 0.5x)
    const plays = playFrequencies[sfx.id] || 0
    const historyScore = (plays / maxPlays) * 0.5

    return { id: sfx.id, score: labelScore + descScore + catScore + labelMoodScore + tagScore + historyScore }
  })

  scored.sort((a, b) => b.score - a.score)

  // Return SFX that scored above 0; if none matched, fall back to defaults
  const matched = scored
    .filter((s) => s.score > 0)
    .slice(0, count)
    .map((s) => s.id)

  if (matched.length > 0) return matched

  // Fallback: no keyword/category matches — return defaults so the column isn't empty
  return defaultSfxRecommendations(sfxList, playFrequencies, count)
}

/**
 * Default SFX recommendations when there's no transcript/prompt or no keyword matches.
 * Returns most-played SFX items, or a diverse random sample if no history exists.
 */
function defaultSfxRecommendations(
  sfxList: SfxMeta[],
  playFrequencies: Record<string, number>,
  count: number,
): string[] {
  const sfxIds = new Set(sfxList.map((s) => s.id))
  const byFrequency = Object.entries(playFrequencies)
    .filter(([id]) => sfxIds.has(id))
    .sort(([, a], [, b]) => b - a)
    .map(([id]) => id)

  if (byFrequency.length > 0) {
    return byFrequency.slice(0, count)
  }

  // No play history — return a category-diverse sample so the column isn't empty
  const seen = new Set<string>()
  const result: string[] = []

  // First pass: pick one from each category for diversity
  for (const sfx of sfxList) {
    if (!seen.has(sfx.category)) {
      seen.add(sfx.category)
      result.push(sfx.id)
      if (result.length >= count) return result
    }
  }

  // Second pass: fill remaining slots
  for (const sfx of sfxList) {
    if (!result.includes(sfx.id)) {
      result.push(sfx.id)
      if (result.length >= count) return result
    }
  }

  return result
}
