import { useState, useRef, useEffect, useCallback } from 'react'

const PINS_KEY = 'doty:pinnedTracks'

interface Props {
  recommendations: string[]
  musicFolder: string
  speakerDeviceId?: string
  onNoFolder: () => void
}

function loadPins(): string[] {
  try { return JSON.parse(localStorage.getItem(PINS_KEY) || '[]') } catch { return [] }
}
function savePins(pins: string[]) {
  localStorage.setItem(PINS_KEY, JSON.stringify(pins))
}

function trackName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/.*[/\\]/, '')
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function PlayIcon() {
  return <svg className="w-3 h-3" fill="#6b4e15" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
}
function PauseIcon() {
  return <svg className="w-3 h-3" fill="#c8922a" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
}
function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={filled ? '#c8922a' : 'none'} stroke={filled ? '#c8922a' : '#6b4e15'} strokeWidth="2">
      <path d="M12 2l2.09 6.26L21 9.27l-5 4.87L17.18 21 12 17.27 6.82 21 8 14.14l-5-4.87 6.91-1.01z" />
    </svg>
  )
}
function ChevronUp() {
  return <svg className="w-3 h-3" fill="#6b4e15" viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" /></svg>
}
function ChevronDown() {
  return <svg className="w-3 h-3" fill="#6b4e15" viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" /></svg>
}
function BrowseIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="#6b4e15" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
}
function CloseIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="#6b4e15" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
}
function SearchIcon() {
  return <svg className="w-3.5 h-3.5" fill="none" stroke="#6b4e15" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
}

// ── Browse Panel ──────────────────────────────────────────────────────────────

function BrowsePanel({
  pinned,
  playing,
  onPlay,
  onPin,
  onClose,
}: {
  pinned: string[]
  playing: string | null
  onPlay: (f: string) => void
  onPin: (f: string) => void
  onClose: () => void
}) {
  const [allFiles, setAllFiles] = useState<string[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    window.doty.listMusic().then(setAllFiles)
  }, [])

  // Escape key to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean)
  const filtered = tokens.length === 0
    ? allFiles
    : allFiles.filter(f => {
        const lower = f.toLowerCase()
        return tokens.every(t => lower.includes(t))
      })

  return (
    <div className="absolute inset-0 z-10 flex flex-col" style={{
      background: '#080705',
      border: '1px solid #2e2416',
    }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid #2e2416' }}>
        <SearchIcon />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tracks..."
          autoFocus
          className="flex-1 bg-transparent outline-none text-sm"
          style={{
            fontFamily: "'Crimson Text', serif",
            fontSize: '14px',
            color: '#c8922a',
          }}
        />
        <span style={{ fontSize: '12px', color: '#3a2e1a', fontFamily: 'monospace' }}>
          {filtered.length}
        </span>
        <button onClick={(e) => { e.stopPropagation(); onClose() }} className="p-2 hover:opacity-80" style={{ cursor: 'pointer' }}>
          <CloseIcon />
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map(f => {
          const isPinned = pinned.includes(f)
          const isPlaying = playing === f
          return (
            <div
              key={f}
              className="flex items-center gap-2 px-3 py-1.5 group"
              style={{
                borderBottom: '1px solid rgba(46,36,22,0.3)',
                background: isPlaying ? 'rgba(200,146,42,0.06)' : 'transparent',
              }}
            >
              <button onClick={() => onPlay(f)} className="w-5 h-5 flex items-center justify-center shrink-0" style={{
                border: `1px solid ${isPlaying ? 'rgba(200,146,42,0.4)' : '#2e2416'}`,
              }}>
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
              <span className="flex-1 min-w-0 truncate" style={{
                fontFamily: "'Crimson Text', serif",
                fontSize: '14px',
                color: isPlaying ? '#e8d5a3' : '#8a7050',
              }}>
                {trackName(f)}
              </span>
              <button
                onClick={() => onPin(f)}
                className="p-0.5 opacity-50 hover:opacity-100 transition-opacity"
                title={isPinned ? 'Unpin' : 'Pin'}
              >
                <PinIcon filled={isPinned} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Player Bar ────────────────────────────────────────────────────────────────

function PlayerBar({
  filename,
  isPlaying,
  progress,
  onToggle,
  onSeek,
}: {
  filename: string
  isPlaying: boolean
  progress: number
  onToggle: () => void
  onSeek: (pct: number) => void
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  function seekFromEvent(e: MouseEvent | React.MouseEvent) {
    if (!barRef.current) return
    const rect = barRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onSeek(pct)
  }

  function handlePointerDown(e: React.PointerEvent) {
    draggingRef.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    seekFromEvent(e)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return
    seekFromEvent(e)
  }

  function handlePointerUp() {
    draggingRef.current = false
  }

  return (
    <div className="shrink-0 flex items-center gap-3 px-3 py-2" style={{
      background: 'linear-gradient(135deg, rgba(200,146,42,0.08), rgba(107,78,21,0.04))',
      borderTop: '1px solid rgba(200,146,42,0.3)',
    }}>
      <button onClick={onToggle} className="w-8 h-8 flex items-center justify-center shrink-0" style={{
        border: '1px solid rgba(200,146,42,0.4)',
        background: 'rgba(200,146,42,0.08)',
      }}>
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div className="flex-1 min-w-0">
        <span className="block truncate" style={{
          fontFamily: "'Crimson Text', serif",
          fontSize: '14px',
          color: '#e8d5a3',
          lineHeight: '1.3',
        }}>
          {trackName(filename)}
        </span>
        <div
          ref={barRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="mt-1 h-3 cursor-pointer flex items-center"
          style={{ touchAction: 'none' }}
        >
          <div className="w-full h-1 relative" style={{ background: 'rgba(200,146,42,0.15)' }}>
            <div className="h-full" style={{
              width: `${progress * 100}%`,
              background: 'linear-gradient(to right, #6b4e15, #c8922a)',
            }} />
          </div>
        </div>
      </div>

      {/* Waveform bars */}
      {isPlaying && (
        <div className="flex items-end gap-px shrink-0" style={{ height: '14px' }}>
          {[0.4, 0.7, 1, 0.6, 0.8, 0.5, 0.9].map((h, b) => (
            <div
              key={b}
              className="w-px rounded-full animate-bounce"
              style={{
                height: `${h * 100}%`,
                background: '#c8922a',
                opacity: 0.7,
                animationDelay: `${b * 0.08}s`,
                animationDuration: '0.6s',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Track Card ────────────────────────────────────────────────────────────────

function TrackCard({
  filename,
  isPlaying,
  isPinned,
  rank,
  showReorder,
  canMoveUp,
  canMoveDown,
  onPlay,
  onPin,
  onMoveUp,
  onMoveDown,
}: {
  filename: string
  isPlaying: boolean
  isPinned: boolean
  rank: number
  showReorder: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onPlay: () => void
  onPin: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const name = trackName(filename)

  return (
    <div
      data-testid="track-card"
      className="relative flex items-center gap-2.5 p-3 transition-all group"
      style={{
        background: isPlaying
          ? 'linear-gradient(135deg, rgba(200,146,42,0.12), rgba(107,78,21,0.06))'
          : 'linear-gradient(160deg, #0f0d09, #080705)',
        border: `1px solid ${isPinned ? 'rgba(200,146,42,0.35)' : isPlaying ? 'rgba(200,146,42,0.5)' : '#2e2416'}`,
        boxShadow: isPlaying
          ? '0 0 16px rgba(200,146,42,0.2), inset 0 1px 0 rgba(200,146,42,0.08)'
          : 'inset 0 1px 0 rgba(255,255,255,0.02)',
      }}
    >
      {/* Play button */}
      <button onClick={onPlay} className="w-7 h-7 flex items-center justify-center shrink-0" style={{
        border: `1px solid ${isPlaying ? 'rgba(200,146,42,0.5)' : '#2e2416'}`,
        background: isPlaying ? 'rgba(200,146,42,0.1)' : 'transparent',
      }}>
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      {/* Track name */}
      <span className="flex-1 min-w-0 truncate" style={{
        fontFamily: "'Crimson Text', serif",
        fontSize: '15px',
        color: isPlaying ? '#e8d5a3' : '#8a7050',
      }}>
        {name}
      </span>

      {/* Reorder buttons (pinned only) */}
      {showReorder && (
        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onMoveUp} disabled={!canMoveUp} className="p-0.5" style={{ opacity: canMoveUp ? 1 : 0.3 }}>
            <ChevronUp />
          </button>
          <button onClick={onMoveDown} disabled={!canMoveDown} className="p-0.5" style={{ opacity: canMoveDown ? 1 : 0.3 }}>
            <ChevronDown />
          </button>
        </div>
      )}

      {/* Pin button */}
      <button
        onClick={onPin}
        className="p-1 opacity-60 hover:opacity-100 transition-opacity"
        title={isPinned ? 'Unpin' : 'Pin'}
      >
        <PinIcon filled={isPinned} />
      </button>

      {/* Rank badge */}
      <span className="absolute top-1.5 right-1.5" style={{
        fontFamily: 'monospace', fontSize: '11px',
        color: isPlaying ? 'rgba(200,146,42,0.4)' : '#2e2416',
        pointerEvents: 'none',
      }}>
        {String(rank).padStart(2, '0')}
      </span>
    </div>
  )
}

// ── Soundboard ────────────────────────────────────────────────────────────────

export default function Soundboard({ recommendations, musicFolder, speakerDeviceId, onNoFolder }: Props) {
  const [playing, setPlaying] = useState<string | null>(null)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [pinned, setPinned] = useState<string[]>(loadPins)
  const [browsing, setBrowsing] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef<number>(0)

  // Persist pins
  useEffect(() => { savePins(pinned) }, [pinned])

  // Update audio output device when speaker selection changes
  useEffect(() => {
    if (audioRef.current && speakerDeviceId) {
      (audioRef.current as any).setSinkId(speakerDeviceId).catch((e: unknown) => {
        console.warn('[music] setSinkId update failed:', e)
      })
    }
  }, [speakerDeviceId])

  // Space bar to toggle play/pause when a track is loaded
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== ' ') return
      // Don't intercept when typing in an input/textarea/select
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

  // Progress tracking
  const updateProgress = useCallback(() => {
    const a = audioRef.current
    if (a && a.duration) {
      setProgress(a.currentTime / a.duration)
    }
    rafRef.current = requestAnimationFrame(updateProgress)
  }, [])

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  function playTrack(filename: string) {
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
  }

  function seekTo(pct: number) {
    const a = audioRef.current
    if (a && a.duration) {
      a.currentTime = pct * a.duration
      setProgress(pct)
    }
  }

  function togglePin(filename: string) {
    setPinned(prev =>
      prev.includes(filename)
        ? prev.filter(f => f !== filename)
        : [...prev, filename]
    )
  }

  function movePin(filename: string, dir: -1 | 1) {
    setPinned(prev => {
      const idx = prev.indexOf(filename)
      if (idx < 0) return prev
      const newIdx = idx + dir
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
      return next
    })
  }

  // Suggestions = recommendations minus pinned, plus currently playing track if not pinned
  const suggestions = recommendations.filter(f => !pinned.includes(f))
  // Keep currently playing track visible in suggestions even if recommendations change
  if (playing && !pinned.includes(playing) && !suggestions.includes(playing)) {
    suggestions.unshift(playing)
  }

  const emptyState = (msg: string, sub?: string) => (
    <div className="flex-1 flex flex-col items-center justify-center relative" style={{
      background: 'linear-gradient(160deg, #0f0d09, #080705)',
      border: '1px solid #2e2416',
    }}>
      <div className="absolute top-0 left-0 w-3 h-3" style={{ borderTop: '1px solid rgba(200,146,42,0.3)', borderLeft: '1px solid rgba(200,146,42,0.3)' }} />
      <div className="absolute bottom-0 right-0 w-3 h-3" style={{ borderBottom: '1px solid rgba(200,146,42,0.3)', borderRight: '1px solid rgba(200,146,42,0.3)' }} />
      <svg className="w-10 h-10 mb-4 opacity-10" viewBox="0 0 24 24" fill="#c8922a">
        <path d="M12 15.5A3.5 3.5 0 018.5 12 3.5 3.5 0 0112 8.5a3.5 3.5 0 013.5 3.5 3.5 3.5 0 01-3.5 3.5m7.43-2.92c.04-.34.07-.68.07-1.08s-.03-.74-.07-1.08l2.32-1.82c.21-.16.27-.46.13-.7l-2.2-3.82c-.13-.24-.42-.32-.66-.24l-2.74 1.1c-.57-.44-1.18-.8-1.86-1.08L14.5 2.42c-.04-.26-.27-.42-.5-.42h-4c-.23 0-.46.16-.5.42L9.13 5.36C8.45 5.64 7.84 6 7.27 6.44L4.53 5.34c-.24-.08-.53 0-.66.24L1.67 9.4c-.14.24-.08.54.13.7l2.32 1.82c-.04.34-.07.69-.07 1.08s.03.74.07 1.08L1.8 15.9c-.21.16-.27.46-.13.7l2.2 3.82c.13.24.42.32.66.24l2.74-1.1c.57.44 1.18.8 1.86 1.08l.37 2.94c.04.26.27.42.5.42h4c.23 0 .46-.16.5-.42l.37-2.94c.68-.28 1.29-.64 1.86-1.08l2.74 1.1c.24.08.53 0 .66-.24l2.2-3.82c.14-.24.08-.54-.13-.7l-2.32-1.82z" />
      </svg>
      <p style={{ fontFamily: "'Cinzel', serif", fontSize: '14px', color: '#6b4e15', letterSpacing: '0.15em', textAlign: 'center' }}>{msg}</p>
      {sub && (
        <button onClick={onNoFolder} style={{ marginTop: '10px', fontSize: '14px', color: '#c8922a', fontFamily: "'Cinzel', serif", letterSpacing: '0.1em', opacity: 0.7 }}>
          {sub}
        </button>
      )}
    </div>
  )

  const hasTracks = pinned.length > 0 || suggestions.length > 0

  return (
    <div className="h-full flex flex-col relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <span style={{
          fontFamily: "'Cinzel', serif",
          fontSize: '15px',
          letterSpacing: '0.25em',
          color: '#6b4e15',
          textTransform: 'uppercase',
        }}>
          Melodic Compendium
        </span>
        <div className="flex items-center gap-3">
          {hasTracks && (
            <span style={{ fontSize: '16px', color: '#3a2e1a', fontFamily: 'monospace' }}>
              {pinned.length > 0 ? `${pinned.length} pinned` : ''}{pinned.length > 0 && suggestions.length > 0 ? ' / ' : ''}{suggestions.length > 0 ? `${suggestions.length} attuned` : ''}
            </span>
          )}
          {musicFolder && (
            <button
              onClick={() => setBrowsing(true)}
              className="p-1.5 hover:opacity-80 transition-opacity"
              title="Browse all tracks"
              style={{ border: '1px solid #2e2416' }}
            >
              <BrowseIcon />
            </button>
          )}
        </div>
      </div>

      {!musicFolder
        ? emptyState('No archive selected', 'Open Configuration')
        : !hasTracks
          ? emptyState('Speak or describe the mood below')
          : (
            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-1.5">
              {/* Pinned section */}
              {pinned.length > 0 && (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <PinIcon filled />
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.2em', color: '#6b4e15', textTransform: 'uppercase' }}>
                      Pinned
                    </span>
                    <div className="flex-1 h-px" style={{ background: 'rgba(200,146,42,0.15)' }} />
                  </div>
                  {pinned.map((f, i) => (
                    <TrackCard
                      key={`pin-${f}`}
                      filename={f}
                      isPlaying={playing === f}
                      isPinned
                      rank={i + 1}
                      showReorder
                      canMoveUp={i > 0}
                      canMoveDown={i < pinned.length - 1}
                      onPlay={() => playTrack(f)}
                      onPin={() => togglePin(f)}
                      onMoveUp={() => movePin(f, -1)}
                      onMoveDown={() => movePin(f, 1)}
                    />
                  ))}
                </>
              )}

              {/* Suggestions section */}
              {suggestions.length > 0 && (
                <>
                  <div className="flex items-center gap-2 mb-1 mt-2">
                    <span style={{ fontSize: '10px', color: '#3a2e1a' }}>&#x2B21;</span>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.2em', color: '#3a2e1a', textTransform: 'uppercase' }}>
                      Suggestions
                    </span>
                    <div className="flex-1 h-px" style={{ background: 'rgba(46,36,22,0.5)' }} />
                  </div>
                  {suggestions.map((f, i) => (
                    <TrackCard
                      key={`sug-${f}`}
                      filename={f}
                      isPlaying={playing === f}
                      isPinned={false}
                      rank={pinned.length + i + 1}
                      showReorder={false}
                      canMoveUp={false}
                      canMoveDown={false}
                      onPlay={() => playTrack(f)}
                      onPin={() => togglePin(f)}
                      onMoveUp={() => {}}
                      onMoveDown={() => {}}
                    />
                  ))}
                </>
              )}
            </div>
          )
      }

      {/* Browse all tracks panel */}
      {browsing && musicFolder && (
        <BrowsePanel
          pinned={pinned}
          playing={playing}
          onPlay={playTrack}
          onPin={togglePin}
          onClose={() => setBrowsing(false)}
        />
      )}

      {/* Persistent player bar */}
      {playing && (
        <PlayerBar
          filename={playing}
          isPlaying={isAudioPlaying}
          progress={progress}
          onToggle={() => playTrack(playing)}
          onSeek={seekTo}
        />
      )}
    </div>
  )
}
