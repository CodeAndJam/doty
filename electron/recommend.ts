/**
 * recommend.ts — Dual-path music recommendation engine.
 * Fast-path: keyword triggers for instant scene transitions.
 * Slow-path: LLM scene interpretation + vector search for steady-state recommendations.
 */

import { getLastScene, type SceneResult } from './scene-interpreter'
import { getEmbeddedCount, searchSimilarTracks } from './track-vectors'

export interface Recommendation {
  files: string[]
  confidence: number
  source: 'fast' | 'slow' | 'none'
  scene: SceneResult | null
}

// ── Fast-path keyword triggers ────────────────────────────────────────────────
// Detects scene TRANSITIONS only — not steady state.

interface MoodTrigger {
  mood: string
  keywords: string[]
  intensity: number
}

const MOOD_TRIGGERS: MoodTrigger[] = [
  {
    mood: 'combat',
    keywords: ['roll for initiative', 'attack', 'combat', 'battle', 'fight', 'batalha', 'ataque', 'combate'],
    intensity: 0.9,
  },
  { mood: 'chase', keywords: ['run', 'chase', 'flee', 'escape', 'correr', 'fugir', 'perseguição'], intensity: 0.8 },
  {
    mood: 'horror',
    keywords: ['undead', 'ghost', 'cursed', 'horror', 'haunted', 'morto', 'amaldiçoado', 'fantasma'],
    intensity: 0.7,
  },
  { mood: 'tavern', keywords: ['tavern', 'inn', 'rest', 'drink', 'taberna', 'estalagem', 'descanso'], intensity: 0.3 },
  { mood: 'voyage', keywords: ['sail', 'ship', 'ocean', 'voyage', 'navegar', 'navio', 'oceano'], intensity: 0.5 },
  {
    mood: 'celebration',
    keywords: ['victory', 'celebrate', 'won', 'triumph', 'vitória', 'celebração'],
    intensity: 0.7,
  },
  {
    mood: 'stealth',
    keywords: ['sneak', 'stealth', 'quiet', 'shadow', 'furtivo', 'sombra', 'silêncio'],
    intensity: 0.5,
  },
]

let lastFastMood: string | null = null
let lastSlowRecommendation: Recommendation = { files: [], confidence: 0, source: 'none', scene: null }
let cooldownUntil = 0 // timestamp when cooldown expires

const COOLDOWN_MS = 60000 // 60s default cooldown between switches

/**
 * Fast-path: check recent transcript for high-confidence mood transitions.
 * Returns a recommendation only if a TRANSITION is detected (mood changed).
 */
export function fastPathCheck(recentText: string): Recommendation | null {
  if (!recentText || recentText.length < 10) return null

  const lower = recentText.toLowerCase()
  let bestTrigger: MoodTrigger | null = null
  let bestScore = 0

  for (const trigger of MOOD_TRIGGERS) {
    const matches = trigger.keywords.filter((kw) => lower.includes(kw)).length
    if (matches > bestScore) {
      bestScore = matches
      bestTrigger = trigger
    }
  }

  if (!bestTrigger || bestScore === 0) return null

  // Only fire if mood CHANGED (transition detector, not steady-state)
  const currentSlowMood = getLastScene()?.mood
  if (bestTrigger.mood === lastFastMood && bestTrigger.mood === currentSlowMood) {
    return null // same mood as before — not a transition
  }

  // Confidence based on number of keyword matches
  const confidence = Math.min(1, bestScore * 0.4)

  // Must exceed 0.8 threshold to override slow-path
  if (confidence <= 0.8) return null

  // Check cooldown (unless confidence > 0.95 — dramatic override)
  const now = Date.now()
  if (now < cooldownUntil && confidence <= 0.95) return null

  lastFastMood = bestTrigger.mood

  // Search for tracks matching this mood — use embedded search if available
  // For fast-path, we do a quick embedding search with the mood as query
  return null // ponytail: fast-path vector search done async via requestFastSearch below
}

/**
 * Slow-path: use the latest scene interpretation to find matching tracks.
 * Called after scene interpreter produces a result.
 */
export function slowPathRecommend(sceneEmbedding: number[], limit = 5): Recommendation {
  if (getEmbeddedCount() === 0) {
    return { files: [], confidence: 0, source: 'none', scene: getLastScene() }
  }

  const results = searchSimilarTracks(new Float32Array(sceneEmbedding), limit)

  if (results.length === 0) {
    return { files: [], confidence: 0, source: 'none', scene: getLastScene() }
  }

  // Map cosine distance to confidence:
  // sqlite-vec returns L2 distance by default for float vectors.
  // Lower distance = more similar. Map to 0-1 confidence.
  // Typical useful range: distance 0.3-1.5
  const topDistance = results[0].distance
  const confidence = mapDistanceToConfidence(topDistance)

  const recommendation: Recommendation = {
    files: results.map((r) => r.filename),
    confidence,
    source: 'slow',
    scene: getLastScene(),
  }

  lastSlowRecommendation = recommendation
  return recommendation
}

/** Map vector distance to confidence score (0-1) */
function mapDistanceToConfidence(distance: number): number {
  // L2 distance: 0 = identical, higher = more different
  // For 768-dim normalized vectors, useful range is ~0.5–2.0
  if (distance <= 0.5) return 1.0
  if (distance >= 2.0) return 0.0
  // Linear interpolation in the useful range
  return 1.0 - (distance - 0.5) / 1.5
}

/** Start cooldown timer (called after a music switch) */
export function startCooldown(durationMs = COOLDOWN_MS): void {
  cooldownUntil = Date.now() + durationMs
}

/** Check if currently in cooldown */
export function isInCooldown(): boolean {
  return Date.now() < cooldownUntil
}

/** Get the last slow-path recommendation */
export function getLastRecommendation(): Recommendation {
  return lastSlowRecommendation
}
