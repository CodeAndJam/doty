/**
 * heuristicRecommend.ts
 * Keyword + audio-feature scoring fallback used while the LLM is loading
 * or when it errors. No ML required — runs synchronously in the renderer.
 *
 * Scoring (0–1 per dimension, combined into a final score):
 *   - Filename keyword match against transcript tokens
 *   - BPM proximity to mood target
 *   - Energy proximity to mood target
 *   - Scale (major/minor) match
 *   - Danceability as tiebreaker
 */

import type { TrackMeta } from '../types'

interface MoodProfile {
  keywords: string[]
  bpmMin: number
  bpmMax: number
  energyMin: number
  energyMax: number
  scale?: 'major' | 'minor'
}

const MOOD_PROFILES: MoodProfile[] = [
  {
    keywords: ['battle', 'combat', 'fight', 'war', 'clash', 'attack', 'assault', 'enemy', 'rivals', 'boss'],
    bpmMin: 120, bpmMax: 200, energyMin: 0.6, energyMax: 1.0,
  },
  {
    keywords: ['chase', 'run', 'escape', 'flee', 'pursuit', 'urgent', 'danger'],
    bpmMin: 130, bpmMax: 200, energyMin: 0.65, energyMax: 1.0,
  },
  {
    keywords: ['campfire', 'camp', 'rest', 'tavern', 'inn', 'peaceful', 'calm', 'relax', 'downtime', 'bonfire', 'halfling', 'village'],
    bpmMin: 60, bpmMax: 100, energyMin: 0.0, energyMax: 0.45, scale: 'major',
  },
  {
    keywords: ['horror', 'dark', 'spooky', 'haunted', 'ghost', 'undead', 'cursed', 'cemetery', 'dungeon', 'corrupted', 'obscure'],
    bpmMin: 50, bpmMax: 110, energyMin: 0.2, energyMax: 0.65, scale: 'minor',
  },
  {
    keywords: ['ocean', 'sea', 'sail', 'voyage', 'ship', 'pirate', 'water', 'storm', 'rowboat'],
    bpmMin: 80, bpmMax: 130, energyMin: 0.3, energyMax: 0.75,
  },
  {
    keywords: ['victory', 'triumph', 'celebration', 'heroic', 'epic', 'glorious'],
    bpmMin: 100, bpmMax: 160, energyMin: 0.6, energyMax: 1.0, scale: 'major',
  },
  {
    keywords: ['travel', 'journey', 'road', 'adventure', 'explore', 'caravan', 'walk', 'mountain', 'snow'],
    bpmMin: 80, bpmMax: 120, energyMin: 0.3, energyMax: 0.65,
  },
  {
    keywords: ['mystery', 'intrigue', 'stealth', 'shadow', 'secret', 'underground', 'cave', 'cavern'],
    bpmMin: 60, bpmMax: 110, energyMin: 0.2, energyMax: 0.55, scale: 'minor',
  },
  {
    keywords: ['desert', 'sand', 'dry', 'heat', 'ancient', 'temple', 'ruin'],
    bpmMin: 70, bpmMax: 110, energyMin: 0.25, energyMax: 0.6,
  },
]

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** Score how well a BPM fits within a target range (1 = perfect, 0 = far outside) */
function bpmScore(bpm: number, min: number, max: number): number {
  if (bpm >= min && bpm <= max) return 1
  const dist = bpm < min ? min - bpm : bpm - max
  return clamp01(1 - dist / 60)
}

/** Score how well an energy value fits within a target range */
function rangeScore(val: number, min: number, max: number): number {
  if (val >= min && val <= max) return 1
  const dist = val < min ? min - val : val - max
  return clamp01(1 - dist / 0.4)
}

/** Detect the dominant mood profile from transcript tokens */
function detectMood(tokens: string[]): MoodProfile | null {
  let best: MoodProfile | null = null
  let bestScore = 0
  for (const profile of MOOD_PROFILES) {
    const score = profile.keywords.filter(k => tokens.includes(k)).length
    if (score > bestScore) { bestScore = score; best = profile }
  }
  return bestScore > 0 ? best : null
}

/** Score a filename against transcript tokens (word overlap) */
function filenameScore(filename: string, tokens: string[]): number {
  const nameTokens = tokenize(filename.replace(/\.[^.]+$/, ''))
  const matches = nameTokens.filter(t => tokens.includes(t)).length
  return Math.min(1, matches / Math.max(1, nameTokens.length) * 2)
}

export function heuristicRecommend(
  transcript: string,
  files: string[],
  metadata: Record<string, TrackMeta>,
  count = 5,
): string[] {
  if (files.length === 0) return []

  const tokens = tokenize(transcript)
  const mood = detectMood(tokens)

  const scored = files.map((file) => {
    const meta = metadata[file]
    const fnScore = filenameScore(file, tokens) * 2  // filename match weighted 2x

    let featureScore = 0
    if (meta && mood) {
      const bpm = bpmScore(meta.bpm, mood.bpmMin, mood.bpmMax)
      const energy = rangeScore(meta.energy, mood.energyMin, mood.energyMax)
      const scale = mood.scale ? (meta.scale === mood.scale ? 1 : 0) : 0.5
      const dance = meta.danceability * 0.3
      featureScore = (bpm + energy + scale + dance) / 3.3
    } else if (meta) {
      // No mood detected — prefer mid-energy tracks as neutral background
      featureScore = rangeScore(meta.energy, 0.3, 0.6) * 0.5
    }

    return { file, score: fnScore + featureScore }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, count).map(s => s.file)
}
