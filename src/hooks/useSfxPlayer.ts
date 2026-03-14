import { useCallback, useRef, useState } from 'react'

/** Maximum simultaneous SFX channels */
const MAX_CHANNELS = 8

interface SfxChannel {
  id: string
  sfxId: string
  label: string
  audio: HTMLAudioElement
  playing: boolean
  looping: boolean
  volume: number
}

export interface UseSfxPlayerReturn {
  /** Currently active SFX channels */
  channels: Omit<SfxChannel, 'audio'>[]
  /** Master SFX volume 0..1 */
  masterVolume: number
  /** Play an SFX by filename. Returns channel id. */
  play: (sfxId: string, label: string, filename: string, loop?: boolean) => string | null
  /** Stop a specific channel */
  stop: (channelId: string) => void
  /** Stop all SFX channels */
  stopAll: () => void
  /** Toggle loop on a channel */
  toggleLoop: (channelId: string) => void
  /** Set volume on a specific channel (0..1) */
  setChannelVolume: (channelId: string, volume: number) => void
  /** Set master SFX volume (0..1) */
  setMasterVolume: (volume: number) => void
  /** Get persisted per-SFX volume (0..1), falls back to master */
  getSfxVolume: (sfxId: string) => number
  /** Set persisted per-SFX volume (0..1) */
  setSfxVolume: (sfxId: string, volume: number) => void
}

const MASTER_VOL_KEY = 'doty:sfxMasterVolume'
const SFX_VOL_PREFIX = 'doty:sfxVol:'

function loadMasterVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem(MASTER_VOL_KEY) || '0.7')
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.7
  } catch {
    return 0.7
  }
}

function loadSfxVolume(sfxId: string): number | null {
  try {
    const raw = localStorage.getItem(SFX_VOL_PREFIX + sfxId)
    if (raw == null) return null
    const v = parseFloat(raw)
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null
  } catch {
    return null
  }
}

let channelCounter = 0

export function useSfxPlayer(): UseSfxPlayerReturn {
  const [channels, setChannels] = useState<SfxChannel[]>([])
  const [masterVolume, setMasterVolumeState] = useState(loadMasterVolume)
  const channelsRef = useRef(channels)
  channelsRef.current = channels
  const masterRef = useRef(masterVolume)
  masterRef.current = masterVolume

  const removeChannel = useCallback((id: string) => {
    setChannels((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const play = useCallback(
    (sfxId: string, label: string, filename: string, loop = false): string | null => {
      // Evict oldest channel if at max
      if (channelsRef.current.length >= MAX_CHANNELS) {
        const oldest = channelsRef.current[0]
        oldest.audio.pause()
        setChannels((prev) => prev.slice(1))
      }

      const id = `sfx-${++channelCounter}`
      const audio = new Audio(`music://play/${encodeURIComponent(filename)}`)
      const vol = loadSfxVolume(sfxId) ?? masterRef.current
      audio.volume = vol
      audio.loop = loop

      audio.onended = () => {
        if (!loop) removeChannel(id)
      }
      audio.onerror = () => removeChannel(id)

      audio.play().catch(() => removeChannel(id))

      // Stream SFX to Discord as an overlay on top of music (fire-and-forget)
      window.doty.discordStreamSfx(filename).catch(() => {})

      const channel: SfxChannel = { id, sfxId, label, audio, playing: true, looping: loop, volume: vol }
      setChannels((prev) => [...prev, channel])
      return id
    },
    [removeChannel],
  )

  const stop = useCallback((channelId: string) => {
    setChannels((prev) => {
      const ch = prev.find((c) => c.id === channelId)
      if (ch) {
        ch.audio.pause()
        ch.audio.currentTime = 0
      }
      return prev.filter((c) => c.id !== channelId)
    })
  }, [])

  const stopAll = useCallback(() => {
    channelsRef.current.forEach((ch) => {
      ch.audio.pause()
      ch.audio.currentTime = 0
    })
    setChannels([])
  }, [])

  const toggleLoop = useCallback((channelId: string) => {
    setChannels((prev) =>
      prev.map((ch) => {
        if (ch.id === channelId) {
          ch.audio.loop = !ch.looping
          return { ...ch, looping: !ch.looping }
        }
        return ch
      }),
    )
  }, [])

  const setChannelVolume = useCallback((channelId: string, volume: number) => {
    setChannels((prev) =>
      prev.map((ch) => {
        if (ch.id === channelId) {
          ch.audio.volume = volume * masterRef.current
          return { ...ch, volume }
        }
        return ch
      }),
    )
  }, [])

  const setMasterVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol))
    setMasterVolumeState(clamped)
    masterRef.current = clamped
    localStorage.setItem(MASTER_VOL_KEY, String(clamped))
    // Update all active channels
    channelsRef.current.forEach((ch) => {
      ch.audio.volume = ch.volume * clamped
    })
  }, [])

  const getSfxVolume = useCallback(
    (sfxId: string): number => loadSfxVolume(sfxId) ?? masterRef.current,
    [],
  )

  const setSfxVolume = useCallback(
    (sfxId: string, volume: number) => {
      const clamped = Math.max(0, Math.min(1, volume))
      localStorage.setItem(SFX_VOL_PREFIX + sfxId, String(clamped))
      // If this SFX is currently playing, update the active channel too
      const ch = channelsRef.current.find((c) => c.sfxId === sfxId)
      if (ch) {
        ch.audio.volume = clamped
        ch.volume = clamped
        setChannels((prev) => prev.map((c) => (c.id === ch.id ? { ...c, volume: clamped } : c)))
      }
    },
    [],
  )

  // Strip audio refs from public API
  const publicChannels = channels.map(({ audio: _, ...rest }) => rest)

  return {
    channels: publicChannels,
    masterVolume,
    play,
    stop,
    stopAll,
    toggleLoop,
    setChannelVolume,
    setMasterVolume,
    getSfxVolume,
    setSfxVolume,
  }
}
