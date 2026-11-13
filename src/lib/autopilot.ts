/**
 * Autopilot configuration and types.
 *
 * Autopilot automatically manages music transitions and SFX triggers
 * when the ranker is highly confident in its recommendations.
 */

export interface AutopilotConfig {
  /** Whether autopilot is enabled (default: false) */
  enabled: boolean
  /** Whether music auto-transitions are enabled (default: true) */
  musicEnabled: boolean
  /** Whether SFX auto-triggers are enabled (default: true) */
  sfxEnabled: boolean
  /** Confidence threshold 0.0-1.0 (default: 0.9) */
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
  confidenceThreshold: 0.9,
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

/**
 * The ranker's probabilities are calibrated, so the number means what it says: above
 * this the suggestion is highlighted, above `confidenceThreshold` autopilot acts on it.
 */
export const HIGHLIGHT_CONFIDENCE = 0.7

/** Confidence label for UI display */
export function confidenceLabel(threshold: number): string {
  if (threshold >= 0.95) return 'Conservative'
  if (threshold >= 0.9) return 'Balanced'
  return 'Adventurous'
}

/** True when `lastPlayedAt` is inside the recently-played avoidance window. */
export function isRecentlyPlayed(lastPlayedAt: number | undefined, now: number, minutes: number): boolean {
  return lastPlayedAt !== undefined && now - lastPlayedAt < minutes * 60_000
}
