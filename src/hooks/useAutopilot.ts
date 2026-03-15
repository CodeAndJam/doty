/**
 * useAutopilot — state machine for automatic music transitions and SFX triggers.
 *
 * Monitors recommendation confidence and automatically acts when the reranker
 * is highly confident, respecting cooldowns, pinned tracks, and manual overrides.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutopilotConfig, AutopilotState } from '../lib/autopilot'
import { DEFAULT_AUTOPILOT_CONFIG } from '../lib/autopilot'

export interface PendingTransition {
  /** Track filename to transition to */
  track: string
  /** Confidence score that triggered this */
  confidence: number
  /** Countdown seconds remaining */
  countdown: number
}

export interface UseAutopilotReturn {
  /** Current autopilot state */
  state: AutopilotState
  /** Current config */
  config: AutopilotConfig
  /** Whether autopilot is enabled */
  enabled: boolean
  /** Pending music transition (if any) — shows countdown UI */
  pendingTransition: PendingTransition | null
  /** Cancel a pending transition */
  cancelTransition: () => void
  /** Notify autopilot of a new recommendation result */
  onRecommendation: (topTrack: string, confidence: number) => void
  /** Notify autopilot that the DM manually interacted (pauses autopilot briefly) */
  onManualAction: () => void
  /** Update config */
  setConfig: (patch: Partial<AutopilotConfig>) => void
}

export function useAutopilot(
  currentTrack: string | null,
  currentTrackStartTime: number | null,
  pinnedTracks: string[],
  onAutoPlay: (track: string) => void,
): UseAutopilotReturn {
  const [config, setConfigState] = useState<AutopilotConfig>(DEFAULT_AUTOPILOT_CONFIG)
  const [state, setState] = useState<AutopilotState>('idle')
  const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(null)

  // Cooldown tracking
  const lastMusicTransitionRef = useRef<number>(0)
  const manualOverrideUntilRef = useRef<number>(0)
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const configRef = useRef(config)
  configRef.current = config

  // Load config from store on mount
  useEffect(() => {
    window.doty.getAutopilotConfig().then((c) => {
      setConfigState(c)
    })
  }, [])

  const setConfig = useCallback((patch: Partial<AutopilotConfig>) => {
    setConfigState((prev) => {
      const next = { ...prev, ...patch }
      window.doty.setAutopilotConfig(patch)
      return next
    })
  }, [])

  const cancelTransition = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
    setPendingTransition(null)
    setState('cooldown')
    // Short cooldown after cancel to avoid immediate re-trigger
    lastMusicTransitionRef.current = Date.now()
  }, [])

  const onManualAction = useCallback(() => {
    // Pause autopilot decisions for 60 seconds after manual interaction
    manualOverrideUntilRef.current = Date.now() + 60_000
    cancelTransition()
    setState('idle')
  }, [cancelTransition])

  const onRecommendation = useCallback(
    (topTrack: string, confidence: number) => {
      const cfg = configRef.current
      if (!cfg.enabled) return
      if (state === 'transitioning') return

      const now = Date.now()

      // Respect manual override pause
      if (now < manualOverrideUntilRef.current) return

      // Check confidence threshold
      if (confidence < cfg.confidenceThreshold) {
        if (state !== 'idle') setState('idle')
        return
      }

      // Don't switch to the same track
      if (topTrack === currentTrack) return

      // Don't replace pinned tracks
      if (currentTrack && pinnedTracks.includes(currentTrack)) return

      // Check music cooldown
      if (now - lastMusicTransitionRef.current < cfg.musicCooldownSeconds * 1000) return

      // Check minimum play time
      if (currentTrackStartTime && now - currentTrackStartTime < cfg.minPlaySeconds * 1000) return

      // All checks passed — start countdown
      setState('pending_transition')
      const countdownSeconds = Math.ceil(cfg.crossfadeDuration)
      setPendingTransition({ track: topTrack, confidence, countdown: countdownSeconds })

      // Start countdown timer
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current)
      }

      let remaining = countdownSeconds
      countdownTimerRef.current = setInterval(() => {
        remaining--
        if (remaining <= 0) {
          // Execute transition
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current)
            countdownTimerRef.current = null
          }
          setState('transitioning')
          setPendingTransition(null)
          lastMusicTransitionRef.current = Date.now()
          onAutoPlay(topTrack)

          // Return to idle after crossfade duration
          setTimeout(() => {
            setState('idle')
          }, cfg.crossfadeDuration * 1000)
        } else {
          setPendingTransition((prev) => (prev ? { ...prev, countdown: remaining } : null))
        }
      }, 1000)
    },
    [state, currentTrack, currentTrackStartTime, pinnedTracks, onAutoPlay],
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current)
      }
    }
  }, [])

  return {
    state,
    config,
    enabled: config.enabled,
    pendingTransition,
    cancelTransition,
    onRecommendation,
    onManualAction,
    setConfig,
  }
}
