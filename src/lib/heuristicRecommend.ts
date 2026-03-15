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
    keywords: [
      'battle',
      'combat',
      'fight',
      'war',
      'clash',
      'attack',
      'assault',
      'enemy',
      'rivals',
      'boss',
      // pt
      'batalha',
      'combate',
      'luta',
      'guerra',
      'ataque',
      'inimigo',
      'inimigos',
      'chefe',
    ],
    bpmMin: 120,
    bpmMax: 200,
    energyMin: 0.6,
    energyMax: 1.0,
  },
  {
    keywords: [
      'chase',
      'run',
      'escape',
      'flee',
      'pursuit',
      'urgent',
      'danger',
      // pt
      'perseguição',
      'correr',
      'fuga',
      'fugir',
      'urgente',
      'perigo',
    ],
    bpmMin: 130,
    bpmMax: 200,
    energyMin: 0.65,
    energyMax: 1.0,
  },
  {
    keywords: [
      'campfire',
      'camp',
      'rest',
      'tavern',
      'inn',
      'peaceful',
      'calm',
      'relax',
      'downtime',
      'bonfire',
      'halfling',
      'village',
      // pt
      'fogueira',
      'acampamento',
      'descanso',
      'taverna',
      'estalagem',
      'pacífico',
      'calmo',
      'relaxar',
      'aldeia',
      'vila',
    ],
    bpmMin: 60,
    bpmMax: 100,
    energyMin: 0.0,
    energyMax: 0.45,
    scale: 'major',
  },
  {
    keywords: [
      'horror',
      'dark',
      'spooky',
      'haunted',
      'ghost',
      'undead',
      'cursed',
      'cemetery',
      'dungeon',
      'corrupted',
      'obscure',
      // pt
      'horror',
      'escuro',
      'assombrado',
      'fantasma',
      'morto',
      'mortos',
      'amaldiçoado',
      'cemitério',
      'masmorra',
      'corrompido',
      'obscuro',
      'trevas',
    ],
    bpmMin: 50,
    bpmMax: 110,
    energyMin: 0.2,
    energyMax: 0.65,
    scale: 'minor',
  },
  {
    keywords: [
      'ocean',
      'sea',
      'sail',
      'voyage',
      'ship',
      'pirate',
      'water',
      'storm',
      'rowboat',
      // pt
      'oceano',
      'mar',
      'navegar',
      'viagem',
      'navio',
      'pirata',
      'água',
      'tempestade',
      'barco',
    ],
    bpmMin: 80,
    bpmMax: 130,
    energyMin: 0.3,
    energyMax: 0.75,
  },
  {
    keywords: [
      'victory',
      'triumph',
      'celebration',
      'heroic',
      'epic',
      'glorious',
      // pt
      'vitória',
      'triunfo',
      'celebração',
      'heroico',
      'épico',
      'glorioso',
    ],
    bpmMin: 100,
    bpmMax: 160,
    energyMin: 0.6,
    energyMax: 1.0,
    scale: 'major',
  },
  {
    keywords: [
      'travel',
      'journey',
      'road',
      'adventure',
      'explore',
      'caravan',
      'walk',
      'mountain',
      'snow',
      // pt
      'viagem',
      'jornada',
      'estrada',
      'aventura',
      'explorar',
      'caravana',
      'caminhar',
      'montanha',
      'neve',
    ],
    bpmMin: 80,
    bpmMax: 120,
    energyMin: 0.3,
    energyMax: 0.65,
  },
  {
    keywords: [
      'mystery',
      'intrigue',
      'stealth',
      'shadow',
      'secret',
      'underground',
      'cave',
      'cavern',
      // pt
      'mistério',
      'intriga',
      'furtivo',
      'sombra',
      'segredo',
      'subterrâneo',
      'caverna',
      'gruta',
    ],
    bpmMin: 60,
    bpmMax: 110,
    energyMin: 0.2,
    energyMax: 0.55,
    scale: 'minor',
  },
  {
    keywords: [
      'desert',
      'sand',
      'dry',
      'heat',
      'ancient',
      'temple',
      'ruin',
      // pt
      'deserto',
      'areia',
      'seco',
      'calor',
      'antigo',
      'templo',
      'ruína',
      'ruínas',
    ],
    bpmMin: 70,
    bpmMax: 110,
    energyMin: 0.25,
    energyMax: 0.6,
  },
]

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
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
    const score = profile.keywords.filter((k) => tokens.includes(k)).length
    if (score > bestScore) {
      bestScore = score
      best = profile
    }
  }
  return bestScore > 0 ? best : null
}

/** Score a filename against transcript tokens (word overlap) */
function filenameScore(filename: string, tokens: string[]): number {
  const nameTokens = tokenize(filename.replace(/\.[^.]+$/, ''))
  const matches = nameTokens.filter((t) => tokens.includes(t)).length
  return Math.min(1, (matches / Math.max(1, nameTokens.length)) * 2)
}

export interface HeuristicResult {
  files: string[]
  /** Estimated confidence 0-1 based on score distribution (top-1 vs rest) */
  confidence: number
}

export function heuristicRecommend(
  transcript: string,
  files: string[],
  metadata: Record<string, TrackMeta>,
  count = 5,
  tagsMap: Record<string, string[]> = {},
  playFrequencies: Record<string, number> = {},
): HeuristicResult {
  if (files.length === 0) return { files: [], confidence: 0 }

  const tokens = tokenize(transcript)

  // If no tokens (empty prompt/transcript), return most-played tracks or random selection
  if (tokens.length === 0) {
    return { files: defaultRecommendations(files, playFrequencies, count), confidence: 0 }
  }

  const mood = detectMood(tokens)

  // Compute max play count for normalization
  const maxPlays = Math.max(1, ...Object.values(playFrequencies))

  const scored = files.map((file) => {
    const meta = metadata[file]
    const fnScore = filenameScore(file, tokens) * 2 // filename match weighted 2x

    // Tag score: direct keyword match against user tags (weighted 3x — user intent is explicit)
    const fileTags = tagsMap[file] || []
    const tagMatches = fileTags.filter((tag) => tokens.some((t) => tag.includes(t) || t.includes(tag))).length
    const tagScore = Math.min(1, tagMatches / Math.max(1, fileTags.length)) * 3

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

    // History boost: frequently played tracks get a small bonus (weighted 0.5x)
    const plays = playFrequencies[file] || 0
    const historyScore = (plays / maxPlays) * 0.5

    return { file, score: fnScore + tagScore + featureScore + historyScore }
  })

  scored.sort((a, b) => b.score - a.score)

  // Estimate confidence from score distribution:
  // High confidence = top score is much higher than the rest
  const topScore = scored[0]?.score ?? 0
  const avgScore =
    scored.length > 1
      ? scored.slice(1, Math.min(6, scored.length)).reduce((s, x) => s + x.score, 0) / Math.min(5, scored.length - 1)
      : 0
  // Confidence based on gap between top and average, normalized to 0-1
  // A top score of 3+ with a gap of 1.5+ over average is high confidence
  const gap = topScore - avgScore
  const confidence = topScore > 0 ? Math.min(1, (gap / Math.max(topScore, 1)) * 0.8 + (topScore > 2 ? 0.2 : 0)) : 0

  return { files: scored.slice(0, count).map((s) => s.file), confidence }
}

/**
 * Default recommendations when there's no transcript/prompt.
 * Returns most-played tracks, padded with random picks if history is sparse.
 */
function defaultRecommendations(files: string[], playFrequencies: Record<string, number>, count: number): string[] {
  // Sort by play count descending
  const byFrequency = files
    .filter((f) => (playFrequencies[f] || 0) > 0)
    .sort((a, b) => (playFrequencies[b] || 0) - (playFrequencies[a] || 0))

  const results = byFrequency.slice(0, count)

  // If we don't have enough history, pad with random tracks
  if (results.length < count) {
    const remaining = files.filter((f) => !results.includes(f))
    // Deterministic shuffle using simple seed from file count
    const shuffled = remaining.sort(() => 0.5 - seededRandom(remaining.length))
    results.push(...shuffled.slice(0, count - results.length))
  }

  return results.slice(0, count)
}

/** Simple seeded pseudo-random for deterministic shuffle within a session */
let _seed = Date.now() % 10000
function seededRandom(_hint: number): number {
  _seed = (_seed * 9301 + 49297) % 233280
  return _seed / 233280
}
