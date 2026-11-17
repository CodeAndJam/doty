/**
 * Autopilot configuration and types.
 *
 * Autopilot automatically manages music transitions and SFX triggers
 * when the ranker is highly confident in its recommendations.
 */

export interface AutopilotConfig {
  /**
   * The master switch, on the header. Off by default: nothing changes on its own
   * until the DM asks for it, and the choice survives a relaunch.
   */
  enabled: boolean
  /** Whether music auto-transitions are enabled (default: true) */
  musicEnabled: boolean
  /** Whether SFX auto-triggers are enabled (default: true) */
  sfxEnabled: boolean
  /**
   * How sure the model must be before cutting the current track short. There is no
   * equivalent bar at a boundary: there, silence is the worse outcome, so the next
   * track is always chosen before the current one ends.
   */
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
 * The top suggestion is marked once it passes this share of the twenty. It is not
 * a gate on acting: that also needs the margin in `DEFAULT_POLICY`.
 */
export const HIGHLIGHT_CONFIDENCE = 0.35

/** Confidence label for UI display */
export function confidenceLabel(threshold: number): string {
  if (threshold >= 0.7) return 'Conservative'
  if (threshold >= 0.45) return 'Balanced'
  return 'Adventurous'
}

/** True when `lastPlayedAt` is inside the recently-played avoidance window. */
export function isRecentlyPlayed(lastPlayedAt: number | undefined, now: number, minutes: number): boolean {
  return lastPlayedAt !== undefined && now - lastPlayedAt < minutes * 60_000
}
