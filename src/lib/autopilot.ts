/**
 * Autopilot configuration and types.
 *
 * Autopilot automatically manages music transitions and SFX triggers
 * when the reranker is highly confident in its recommendations.
 */

export interface AutopilotConfig {
  /** Whether autopilot is enabled (default: false) */
  enabled: boolean
  /** Whether music auto-transitions are enabled (default: true) */
  musicEnabled: boolean
  /** Whether SFX auto-triggers are enabled (default: true) */
  sfxEnabled: boolean
  /** Confidence threshold 0.0-1.0 (default: 0.95) */
  confidenceThreshold: number
  /** Crossfade duration in seconds (default: 3) */
  crossfadeDuration: number
  /** Minimum seconds between auto music transitions (default: 60) */
  musicCooldownSeconds: number
  /** Minimum seconds current track must play before auto-switch (default: 30) */
  minPlaySeconds: number
  /** Minimum seconds between same SFX auto-trigger (default: 30) */
  sfxPerEffectCooldownSeconds: number
  /** Minimum seconds between any SFX auto-trigger (default: 10) */
  sfxGlobalCooldownSeconds: number
  /** Volume multiplier for auto-triggered SFX (default: 0.7) */
  sfxAutoVolume: number
  /** Minutes to avoid replaying a recently auto-played track (default: 10) */
  recentlyPlayedMinutes: number
}

export const DEFAULT_AUTOPILOT_CONFIG: AutopilotConfig = {
  enabled: false,
  musicEnabled: true,
  sfxEnabled: true,
  confidenceThreshold: 0.95,
  crossfadeDuration: 3,
  musicCooldownSeconds: 60,
  minPlaySeconds: 30,
  sfxPerEffectCooldownSeconds: 30,
  sfxGlobalCooldownSeconds: 10,
  sfxAutoVolume: 0.7,
  recentlyPlayedMinutes: 10,
}

/** Autopilot state machine states */
export type AutopilotState = 'idle' | 'evaluating' | 'pending_transition' | 'transitioning' | 'cooldown'

/** Confidence label for UI display */
export function confidenceLabel(threshold: number): string {
  if (threshold >= 0.95) return 'Conservative'
  if (threshold >= 0.9) return 'Balanced'
  return 'Adventurous'
}

/** Compute softmax over an array of logits, returning probabilities */
export function softmax(logits: number[]): number[] {
  if (logits.length === 0) return []
  const max = Math.max(...logits)
  const exps = logits.map((l) => Math.exp(l - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps.map((e) => e / sum)
}

/** Get the confidence score (top-1 probability) from raw logits */
export function topConfidence(logits: number[]): { index: number; confidence: number } {
  if (logits.length === 0) return { index: -1, confidence: 0 }
  const probs = softmax(logits)
  let maxIdx = 0
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > probs[maxIdx]) maxIdx = i
  }
  return { index: maxIdx, confidence: probs[maxIdx] }
}
