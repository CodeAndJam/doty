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

export interface AutoSfxEvent {
  /** SFX ID that was auto-triggered */
  sfxId: string
  /** Timestamp when triggered */
  timestamp: number
}

export type DecisionAction = 'skip' | 'pending' | 'play' | 'sfx_play' | 'cancel'

export interface DecisionLogEntry {
  /** Timestamp */
  time: number
  /** What type: music or sfx */
  channel: 'music' | 'sfx'
  /** What happened */
  action: DecisionAction
  /** The candidate track/sfx */
  candidate: string
  /** Confidence score (0-1) */
  confidence: number
  /** Human-readable reason */
  reason: string
}

const MAX_LOG_ENTRIES = 50

export interface UseAutopilotReturn {
  /** Current autopilot state */
  state: AutopilotState
  /** Current config */
  config: AutopilotConfig
  /** Whether autopilot is enabled */
  enabled: boolean
  /** Pending music transition (if any) — shows countdown UI */
  pendingTransition: PendingTransition | null
  /** Last auto-triggered SFX (for flash UI) */
  lastAutoSfx: AutoSfxEvent | null
  /** Current top-1 confidence from last evaluation */
  lastConfidence: number
  /** Last evaluated candidate track */
  lastCandidate: string | null
  /** Decision log for transparency */
  decisionLog: DecisionLogEntry[]
  /** Cancel a pending transition */
  cancelTransition: () => void
  /** Notify autopilot of a new recommendation result */
  onRecommendation: (topTrack: string, confidence: number) => void
  /** Notify autopilot of SFX recommendations */
  onSfxRecommendation: (sfxIds: string[]) => void
  /** Notify autopilot that the DM manually interacted (pauses autopilot briefly) */
  onManualAction: () => void
  /** Update config */
  setConfig: (patch: Partial<AutopilotConfig>) => void
  /** Reload config from the persistent store (call after Settings closes) */
  reloadConfig: () => void
}

export function useAutopilot(
  currentTrack: string | null,
  currentTrackStartTime: number | null,
  pinnedTracks: string[],
  onAutoPlay: (track: string) => void,
  onAutoSfx: (sfxId: string, volume: number) => void,
  isSfxPlaying: boolean,
): UseAutopilotReturn {
  const [config, setConfigState] = useState<AutopilotConfig>(DEFAULT_AUTOPILOT_CONFIG)
  const [state, setState] = useState<AutopilotState>('idle')
  const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(null)
  const [lastAutoSfx, setLastAutoSfx] = useState<AutoSfxEvent | null>(null)
  const [lastConfidence, setLastConfidence] = useState(0)
  const [lastCandidate, setLastCandidate] = useState<string | null>(null)
  const [decisionLog, setDecisionLog] = useState<DecisionLogEntry[]>([])

  // Cooldown tracking
  const lastMusicTransitionRef = useRef<number>(0)
  const manualOverrideUntilRef = useRef<number>(0)
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // SFX cooldown tracking
  const lastSfxGlobalRef = useRef<number>(0)
  const sfxPerEffectCooldownMap = useRef<Map<string, number>>(new Map())

  // Recent-track avoidance: map of track -> timestamp when auto-played
  const recentlyPlayedRef = useRef<Map<string, number>>(new Map())

  const configRef = useRef(config)
  configRef.current = config

  const addLogEntry = useCallback((entry: Omit<DecisionLogEntry, 'time'>) => {
    setDecisionLog((prev) => [{ ...entry, time: Date.now() }, ...prev].slice(0, MAX_LOG_ENTRIES))
  }, [])

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

  const reloadConfig = useCallback(() => {
    window.doty.getAutopilotConfig().then((c) => {
      setConfigState(c)
    })
  }, [])

  const cancelTransition = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
    addLogEntry({
      channel: 'music',
      action: 'cancel',
      candidate: lastCandidate ?? '',
      confidence: lastConfidence,
      reason: 'manually cancelled',
    })
    setPendingTransition(null)
    setState('cooldown')
    // Short cooldown after cancel to avoid immediate re-trigger
    lastMusicTransitionRef.current = Date.now()
  }, [addLogEntry, lastCandidate, lastConfidence])

  const onManualAction = useCallback(() => {
    // Pause autopilot decisions for 60 seconds after manual interaction
    manualOverrideUntilRef.current = Date.now() + 60_000
    cancelTransition()
    setState('idle')
  }, [cancelTransition])

  const onRecommendation = useCallback(
    (topTrack: string, confidence: number) => {
      // Always track latest confidence/candidate for UI display
      setLastConfidence(confidence)
      setLastCandidate(topTrack)

      const cfg = configRef.current
      if (!cfg.enabled || !cfg.musicEnabled) {
        addLogEntry({ channel: 'music', action: 'skip', candidate: topTrack, confidence, reason: 'autopilot disabled' })
        return
      }
      if (state === 'transitioning') {
        addLogEntry({
          channel: 'music',
          action: 'skip',
          candidate: topTrack,
          confidence,
          reason: 'already transitioning',
        })
        return
      }

      const now = Date.now()

      // Respect manual override pause
      if (now < manualOverrideUntilRef.current) {
        addLogEntry({
          channel: 'music',
          action: 'skip',
          candidate: topTrack,
          confidence,
          reason: 'manual override active',
        })
        return
      }

      // Check confidence threshold
      if (confidence < cfg.confidenceThreshold) {
        addLogEntry({
          channel: 'music',
          action: 'skip',
          candidate: topTrack,
          confidence,
          reason: `below threshold (${(cfg.confidenceThreshold * 100).toFixed(0)}%)`,
        })
        if (state !== 'idle') setState('idle')
        return
      }

      // Don't switch to the same track
      if (topTrack === currentTrack) {
        addLogEntry({
          channel: 'music',
          action: 'skip',
          candidate: topTrack,
          confidence,
          reason: 'same as current track',
        })
        return
      }

      // Don't replay recently auto-played tracks
      const lastPlayed = recentlyPlayedRef.current.get(topTrack)
      if (lastPlayed && now - lastPlayed < cfg.recentlyPlayedMinutes * 60_000) {
        const minsAgo = ((now - lastPlayed) / 60_000).toFixed(0)
        addLogEntry({
          channel: 'music',
          action: 'skip',
          candidate: topTrack,
          confidence,
          reason: `played ${minsAgo}m ago (avoid ${cfg.recentlyPlayedMinutes}m)`,
        })
        return
      }

      // Don't replace pinned tracks
      if (currentTrack && pinnedTracks.includes(currentTrack)) {
        addLogEntry({
          channel: 'music',
          action: 'skip',
          candidate: topTrack,
          confidence,
          reason: 'current track is pinned',
        })
        return
      }

      // Check music cooldown
      if (now - lastMusicTransitionRef.current < cfg.musicCooldownSeconds * 1000) {
        addLogEntry({ channel: 'music', action: 'skip', candidate: topTrack, confidence, reason: 'cooldown active' })
        return
      }

      // Check minimum play time
      if (currentTrackStartTime && now - currentTrackStartTime < cfg.minPlaySeconds * 1000) {
        addLogEntry({
          channel: 'music',
          action: 'skip',
          candidate: topTrack,
          confidence,
          reason: 'min play time not reached',
        })
        return
      }

      // All checks passed — start countdown
      addLogEntry({
        channel: 'music',
        action: 'pending',
        candidate: topTrack,
        confidence,
        reason: 'starting countdown',
      })
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
          addLogEntry({
            channel: 'music',
            action: 'play',
            candidate: topTrack,
            confidence,
            reason: 'countdown complete',
          })
          // Record track as recently played to avoid repeat cycling
          recentlyPlayedRef.current.set(topTrack, Date.now())
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
    [state, currentTrack, currentTrackStartTime, pinnedTracks, onAutoPlay, addLogEntry],
  )

  // ── SFX auto-trigger ────────────────────────────────────────────────

  const onSfxRecommendation = useCallback(
    (sfxIds: string[]) => {
      const cfg = configRef.current
      if (!cfg.enabled || !cfg.sfxEnabled) return
      if (sfxIds.length === 0) return

      const now = Date.now()

      // Respect manual override pause
      if (now < manualOverrideUntilRef.current) return

      // Don't auto-trigger if DM is manually playing an SFX
      if (isSfxPlaying) return

      // Global SFX cooldown
      if (now - lastSfxGlobalRef.current < cfg.sfxGlobalCooldownSeconds * 1000) return

      // Find the first SFX that isn't on per-effect cooldown
      const candidate = sfxIds.find((id) => {
        const lastPlayed = sfxPerEffectCooldownMap.current.get(id) ?? 0
        return now - lastPlayed >= cfg.sfxPerEffectCooldownSeconds * 1000
      })

      if (!candidate) return

      // Auto-trigger the SFX
      console.log('[autopilot] auto-triggering SFX:', candidate)
      addLogEntry({ channel: 'sfx', action: 'sfx_play', candidate, confidence: 0, reason: 'auto-triggered' })
      lastSfxGlobalRef.current = now
      sfxPerEffectCooldownMap.current.set(candidate, now)
      setLastAutoSfx({ sfxId: candidate, timestamp: now })
      onAutoSfx(candidate, cfg.sfxAutoVolume)

      // Clear the flash indicator after 2 seconds
      setTimeout(() => {
        setLastAutoSfx((prev) => (prev?.timestamp === now ? null : prev))
      }, 2000)
    },
    [isSfxPlaying, onAutoSfx, addLogEntry],
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
    lastAutoSfx,
    lastConfidence,
    lastCandidate,
    decisionLog,
    cancelTransition,
    onRecommendation,
    onSfxRecommendation,
    onManualAction,
    setConfig,
    reloadConfig,
  }
}
