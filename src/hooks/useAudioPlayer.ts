import { useCallback, useEffect, useRef, useState } from 'react'
import type { LoopMode } from '../types'
import { useCrossfade } from './useCrossfade'
import { useLoop } from './useLoop'
import { useVolume } from './useVolume'

/** Short fade for pause/resume (ms) — half the crossfade or 300ms max */
function pauseFadeMs(crossfadeMs: number): number {
  return Math.min(crossfadeMs / 2, 300)
}

interface UseAudioPlayerOptions {
  speakerDeviceId?: string
  onNoFolder: () => void
  musicFolder: string
  /** Called when a track finishes naturally (not paused/stopped). Used by queue to advance. */
  onTrackEnd?: () => void
}

export interface UseAudioPlayerReturn {
  playing: string | null
  isAudioPlaying: boolean
  progress: number
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  effectiveVolume: number
  loopMode: LoopMode
  crossfadeMs: number
  playTrack: (filename: string, forceRestart?: boolean) => void
  /** Stop playback and reset state (used by queue when no next track). */
  stopPlayback: () => void
  seekTo: (pct: number) => void
  seekStart: () => void
  seekEnd: () => void
  setVolume: (v: number) => void
  toggleMute: () => void
  setLoopMode: (mode: LoopMode) => void
  cycleLoopMode: () => void
  setCrossfadeMs: (ms: number) => void
}

/** Fade an audio element's volume to a target over `ms` milliseconds. */
function fadeVolume(audio: HTMLAudioElement, from: number, to: number, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      audio.volume = to
      resolve()
      return
    }
    const steps = Math.ceil(ms / 16) // ~60fps
    const delta = (to - from) / steps
    let step = 0
    audio.volume = from
    const id = setInterval(() => {
      step++
      if (step >= steps) {
        audio.volume = to
        clearInterval(id)
        resolve()
      } else {
        audio.volume = Math.max(0, Math.min(1, from + delta * step))
      }
    }, 16)
  })
}

export function useAudioPlayer({
  speakerDeviceId,
  onNoFolder,
  musicFolder,
  onTrackEnd,
}: UseAudioPlayerOptions): UseAudioPlayerReturn {
  const [playing, setPlaying] = useState<string | null>(null)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef<number>(0)
  const seekingRef = useRef(false)

  // Compose smaller hooks
  const { volume, muted, effectiveVolume, setVolume, toggleMute } = useVolume()
  const { loopMode, setLoopMode, cycleLoopMode } = useLoop()
  const { crossfadeMs, setCrossfadeMs } = useCrossfade()

  // Apply volume changes to current audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = effectiveVolume
    }
  }, [effectiveVolume])

  // Apply loop changes to current audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.loop = loopMode === 'single'
    }
  }, [loopMode])

  // Update audio output device when speaker selection changes
  useEffect(() => {
    if (audioRef.current && speakerDeviceId) {
      ;(audioRef.current as any).setSinkId(speakerDeviceId).catch((e: unknown) => {
        console.warn('[music] setSinkId update failed:', e)
      })
    }
  }, [speakerDeviceId])

  // Space bar to toggle play/pause
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === ' ') {
        if (!playing || !audioRef.current) return
        e.preventDefault()
        if (isAudioPlaying) {
          audioRef.current.pause()
          setIsAudioPlaying(false)
          window.doty.discordPauseStream().catch(() => {})
        } else {
          audioRef.current.play()
          setIsAudioPlaying(true)
          window.doty.discordResumeStream().catch(() => {})
        }
      } else if (e.key === 'm' || e.key === 'M') {
        toggleMute()
      } else if (e.key === 'l' || e.key === 'L') {
        cycleLoopMode()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [playing, isAudioPlaying, toggleMute, cycleLoopMode])

  // Progress tracking via rAF — skip updates while user is seeking
  const updateProgress = useCallback(() => {
    if (!seekingRef.current) {
      const a = audioRef.current
      if (a && Number.isFinite(a.duration) && a.duration > 0) {
        setProgress(a.currentTime / a.duration)
        setCurrentTime(a.currentTime)
        setDuration(a.duration)
      }
    }
    rafRef.current = requestAnimationFrame(updateProgress)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const playTrack = useCallback(
    (filename: string, forceRestart = false) => {
      if (!musicFolder) {
        onNoFolder()
        return
      }

      // Toggle pause/resume if same track (unless forced restart, e.g. from queue wrap)
      if (!forceRestart && playing === filename && audioRef.current) {
        if (isAudioPlaying) {
          const fadeDur = pauseFadeMs(crossfadeMs)
          if (fadeDur > 0) {
            const a = audioRef.current
            fadeVolume(a, a.volume, 0, fadeDur).then(() => {
              a.pause()
              a.volume = effectiveVolume // restore for resume
            })
          } else {
            audioRef.current.pause()
          }
          setIsAudioPlaying(false)
          window.doty.discordPauseStream().catch(() => {})
        } else {
          const fadeDur = pauseFadeMs(crossfadeMs)
          if (fadeDur > 0) {
            audioRef.current.volume = 0
            audioRef.current.play()
            fadeVolume(audioRef.current, 0, effectiveVolume, fadeDur)
          } else {
            audioRef.current.play()
          }
          setIsAudioPlaying(true)
          window.doty.discordResumeStream().catch(() => {})
        }
        return
      }

      const prev = audioRef.current

      // Create new audio element and fade in
      const audio = new Audio(`music://play/${encodeURIComponent(filename)}`)
      audio.volume = 0 // start silent for fade-in
      audio.loop = loopMode === 'single'

      if (speakerDeviceId) {
        ;(audio as any).setSinkId(speakerDeviceId).catch((e: unknown) => {
          console.warn('[music] setSinkId failed:', e)
        })
      }
      audio.onended = () => {
        if (onTrackEnd) {
          onTrackEnd()
        } else {
          setPlaying(null)
          setIsAudioPlaying(false)
          setProgress(0)
          setCurrentTime(0)
          setDuration(0)
        }
      }
      audio.onerror = () => {
        setPlaying(null)
        setIsAudioPlaying(false)
        setProgress(0)
        setCurrentTime(0)
        setDuration(0)
      }
      // Capture duration as soon as metadata is available
      audio.onloadedmetadata = () => {
        if (Number.isFinite(audio.duration)) {
          setDuration(audio.duration)
        }
      }

      // Mirror playback to Discord (fire-and-forget)
      window.doty.discordStreamTrack(filename).catch(() => {})

      // Crossfade: fade out old, fade in new
      if (prev && !prev.paused) {
        const prevVol = prev.volume
        cancelAnimationFrame(rafRef.current)
        audio.play()
        audioRef.current = audio
        setPlaying(filename)
        setIsAudioPlaying(true)
        setProgress(0)
        setCurrentTime(0)
        rafRef.current = requestAnimationFrame(updateProgress)

        // Fade out old + fade in new in parallel
        fadeVolume(prev, prevVol, 0, crossfadeMs).then(() => {
          prev.pause()
        })
        fadeVolume(audio, 0, effectiveVolume, crossfadeMs)
      } else {
        // No previous track playing — just fade in
        if (prev) {
          prev.pause()
          cancelAnimationFrame(rafRef.current)
        }
        audio.play()
        audioRef.current = audio
        setPlaying(filename)
        setIsAudioPlaying(true)
        setProgress(0)
        setCurrentTime(0)
        rafRef.current = requestAnimationFrame(updateProgress)
        fadeVolume(audio, 0, effectiveVolume, crossfadeMs)
      }
    },
    [
      musicFolder,
      playing,
      isAudioPlaying,
      speakerDeviceId,
      onNoFolder,
      updateProgress,
      effectiveVolume,
      loopMode,
      onTrackEnd,
      crossfadeMs,
    ],
  )

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      cancelAnimationFrame(rafRef.current)
    }
    window.doty.discordStopStream().catch(() => {})
    setPlaying(null)
    setIsAudioPlaying(false)
    setProgress(0)
    setCurrentTime(0)
    setDuration(0)
  }, [])

  const seekTo = useCallback(
    (pct: number) => {
      const a = audioRef.current
      if (a && Number.isFinite(a.duration) && a.duration > 0) {
        a.currentTime = pct * a.duration
        setProgress(pct)
        setCurrentTime(a.currentTime)
        // Re-stream from the new position on Discord
        if (playing) {
          window.doty.discordStreamTrack(playing, a.currentTime).catch(() => {})
        }
      }
    },
    [playing],
  )

  /** Call when user starts dragging the seek bar. */
  const seekStart = useCallback(() => {
    seekingRef.current = true
  }, [])
  /** Call when user finishes dragging the seek bar. */
  const seekEnd = useCallback(() => {
    seekingRef.current = false
  }, [])

  return {
    playing,
    isAudioPlaying,
    progress,
    currentTime,
    duration,
    volume,
    muted,
    effectiveVolume,
    loopMode,
    crossfadeMs,
    playTrack,
    stopPlayback,
    seekTo,
    seekStart,
    seekEnd,
    setVolume,
    toggleMute,
    setLoopMode,
    cycleLoopMode,
    setCrossfadeMs,
  }
}
