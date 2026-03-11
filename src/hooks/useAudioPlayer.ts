import { useState, useRef, useEffect, useCallback } from 'react'

interface UseAudioPlayerOptions {
  speakerDeviceId?: string
  onNoFolder: () => void
  musicFolder: string
}

export function useAudioPlayer({ speakerDeviceId, onNoFolder, musicFolder }: UseAudioPlayerOptions) {
  const [playing, setPlaying] = useState<string | null>(null)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef<number>(0)

  // Update audio output device when speaker selection changes
  useEffect(() => {
    if (audioRef.current && speakerDeviceId) {
      (audioRef.current as any).setSinkId(speakerDeviceId).catch((e: unknown) => {
        console.warn('[music] setSinkId update failed:', e)
      })
    }
  }, [speakerDeviceId])

  // Space bar to toggle play/pause
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== ' ') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (!playing || !audioRef.current) return
      e.preventDefault()
      if (isAudioPlaying) {
        audioRef.current.pause()
        setIsAudioPlaying(false)
      } else {
        audioRef.current.play()
        setIsAudioPlaying(true)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [playing, isAudioPlaying])

  // Progress tracking via rAF
  const updateProgress = useCallback(() => {
    const a = audioRef.current
    if (a && a.duration) {
      setProgress(a.currentTime / a.duration)
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

  const playTrack = useCallback((filename: string) => {
    if (!musicFolder) { onNoFolder(); return }

    // Toggle pause/resume if same track
    if (playing === filename && audioRef.current) {
      if (isAudioPlaying) {
        audioRef.current.pause()
        setIsAudioPlaying(false)
      } else {
        audioRef.current.play()
        setIsAudioPlaying(true)
      }
      return
    }

    // Stop current
    if (audioRef.current) {
      audioRef.current.pause()
      cancelAnimationFrame(rafRef.current)
    }

    const audio = new Audio(`music://play/${encodeURIComponent(filename)}`)
    if (speakerDeviceId) {
      (audio as any).setSinkId(speakerDeviceId).catch((e: unknown) => {
        console.warn('[music] setSinkId failed:', e)
      })
    }
    audio.onended = () => { setPlaying(null); setIsAudioPlaying(false); setProgress(0) }
    audio.onerror = () => { setPlaying(null); setIsAudioPlaying(false); setProgress(0) }
    audio.play()
    audioRef.current = audio
    setPlaying(filename)
    setIsAudioPlaying(true)
    setProgress(0)
    rafRef.current = requestAnimationFrame(updateProgress)
  }, [musicFolder, playing, isAudioPlaying, speakerDeviceId, onNoFolder, updateProgress])

  const seekTo = useCallback((pct: number) => {
    const a = audioRef.current
    if (a && a.duration) {
      a.currentTime = pct * a.duration
      setProgress(pct)
    }
  }, [])

  return { playing, isAudioPlaying, progress, playTrack, seekTo }
}
