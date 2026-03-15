import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { useQueue } from '../hooks/useQueue'
import { useSfxPlayer } from '../hooks/useSfxPlayer'
import type { SfxMeta, TrackMeta } from '../types'
import BrowsePanel from './BrowsePanel'
import { BrowseIcon, ChevronDown, ChevronUp, MusicNoteIcon, PinIcon, SfxIcon, StopIcon } from './Icons'
import PlayerBar from './PlayerBar'
import QueuePanel from './QueuePanel'
import SfxBrowsePanel from './SfxBrowsePanel'
import SfxCard from './SfxCard'
import TrackCard from './TrackCard'

const PINS_KEY = 'doty:pinnedTracks'
const SFX_PINS_KEY = 'doty:pinnedSfx'

function loadPins(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PINS_KEY) || '[]')
  } catch {
    return []
  }
}
function savePins(pins: string[]) {
  localStorage.setItem(PINS_KEY, JSON.stringify(pins))
}
function loadSfxPins(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SFX_PINS_KEY) || '[]')
  } catch {
    return []
  }
}
function saveSfxPins(pins: string[]) {
  localStorage.setItem(SFX_PINS_KEY, JSON.stringify(pins))
}

interface Props {
  recommendations: string[]
  sfxRecommendations: string[]
  musicFolder: string
  speakerDeviceId?: string
  onNoFolder: () => void
}

export default function Soundboard({
  recommendations,
  sfxRecommendations,
  musicFolder,
  speakerDeviceId,
  onNoFolder,
}: Props) {
  // ── Music state ──────────────────────────────────────────────────────
  const [pinned, setPinned] = useState<string[]>(loadPins)
  const [browsing, setBrowsing] = useState(false)
  const [showQueue, setShowQueue] = useState(false)
  const [showMusic, setShowMusic] = useState(true)
  const [metaMap, setMetaMap] = useState<Record<string, TrackMeta>>({})
  const [tagsMap, setTagsMap] = useState<Record<string, string[]>>({})
  const [allTags, setAllTags] = useState<string[]>([])
  const queue = useQueue()

  // ── SFX state ────────────────────────────────────────────────────────
  const [allSfx, setAllSfx] = useState<SfxMeta[]>([])
  const [sfxPinned, setSfxPinned] = useState<string[]>(loadSfxPins)
  const [sfxTagsMap, setSfxTagsMap] = useState<Record<string, string[]>>({})
  const [sfxAllTags, setSfxAllTags] = useState<string[]>([])
  const [browsingSfx, setBrowsingSfx] = useState(false)
  const [showSfx, setShowSfx] = useState(true)
  const sfxPlayer = useSfxPlayer()

  // ── Audio player ─────────────────────────────────────────────────────
  const trackEndRef = useRef<() => void>(() => {})
  const handleTrackEnd = useCallback(() => {
    trackEndRef.current()
  }, [])

  const {
    playing,
    isAudioPlaying,
    progress,
    currentTime,
    duration,
    volume,
    muted,
    loopMode,
    playTrack,
    stopPlayback,
    seekTo,
    seekStart,
    seekEnd,
    setVolume,
    toggleMute,
    cycleLoopMode,
  } = useAudioPlayer({ speakerDeviceId, onNoFolder, musicFolder, onTrackEnd: handleTrackEnd })

  // Keep the ref in sync with current queue/loop/playback state
  useEffect(() => {
    trackEndRef.current = () => {
      if (queue.tracks.length === 0) {
        stopPlayback()
        return
      }
      const isLast = queue.currentIndex >= queue.tracks.length - 1
      if (loopMode === 'single') {
        if (queue.currentTrack) playTrack(queue.currentTrack, true)
      } else if (loopMode === 'queue' || !isLast) {
        const track = queue.next(loopMode === 'queue')
        if (track) playTrack(track, true)
        else stopPlayback()
      } else {
        stopPlayback()
      }
    }
  }, [queue, loopMode, playTrack, stopPlayback])

  // Watch queue.currentTrack
  const lastQueueTrackRef = useRef<string | null>(null)
  const lastQueueIndexRef = useRef<number>(-1)
  useEffect(() => {
    const cur = queue.currentTrack
    const idx = queue.currentIndex
    if (cur && (cur !== lastQueueTrackRef.current || idx !== lastQueueIndexRef.current)) {
      playTrack(cur, true)
      lastQueueTrackRef.current = cur
      lastQueueIndexRef.current = idx
    } else if (!cur) {
      lastQueueTrackRef.current = null
      lastQueueIndexRef.current = -1
    }
  }, [queue.currentTrack, queue.currentIndex, playTrack]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data loading ─────────────────────────────────────────────────────

  // Fetch music metadata
  useEffect(() => {
    if (!musicFolder) return
    window.doty
      .getAllMetadata()
      .then(setMetaMap)
      .catch(() => {})
    window.doty
      .getTagsMap()
      .then(setTagsMap)
      .catch(() => {})
    window.doty
      .getAllTags()
      .then(setAllTags)
      .catch(() => {})
  }, [musicFolder])

  // Re-fetch after scan completes
  useEffect(() => {
    const unsub = window.doty.onScanComplete(() => {
      window.doty
        .getAllMetadata()
        .then(setMetaMap)
        .catch(() => {})
    })
    return unsub
  }, [])

  // Load SFX list on mount
  useEffect(() => {
    window.doty
      .getSfxList()
      .then(setAllSfx)
      .catch(() => setAllSfx([]))
  }, [])

  // Load SFX tags on mount
  useEffect(() => {
    window.doty
      .getTagsMap()
      .then(setSfxTagsMap)
      .catch(() => {})
    window.doty
      .getAllTags()
      .then(setSfxAllTags)
      .catch(() => {})
  }, [])

  // Persist pins
  useEffect(() => {
    savePins(pinned)
  }, [pinned])
  useEffect(() => {
    saveSfxPins(sfxPinned)
  }, [sfxPinned])

  // ── Keyboard shortcuts: N = next, P = prev ───────────────────────────
  function handleSkipNext() {
    if (queue.tracks.length === 0) return
    const track = queue.next(loopMode === 'queue')
    if (track) playTrack(track, true)
  }

  function handleSkipPrev() {
    if (queue.tracks.length === 0) return
    const track = queue.prev(loopMode === 'queue')
    if (track) playTrack(track, true)
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (queue.tracks.length === 0) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        handleSkipNext()
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        handleSkipPrev()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [queue.tracks.length, handleSkipNext, handleSkipPrev]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Music handlers ───────────────────────────────────────────────────

  function handlePlayTrack(filename: string, forceRestart?: boolean) {
    playTrack(filename, forceRestart)
    window.doty.recordPlay(filename, 'music').catch(() => {})
  }

  function togglePin(filename: string) {
    setPinned((prev) => (prev.includes(filename) ? prev.filter((f) => f !== filename) : [...prev, filename]))
  }

  function movePin(filename: string, dir: -1 | 1) {
    setPinned((prev) => {
      const idx = prev.indexOf(filename)
      if (idx < 0) return prev
      const newIdx = idx + dir
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
      return next
    })
  }

  function handleTagsChange(filename: string, tags: string[]) {
    window.doty
      .setTags(filename, tags)
      .then(() => {
        setTagsMap((prev) => ({ ...prev, [filename]: tags }))
        window.doty
          .getAllTags()
          .then(setAllTags)
          .catch(() => {})
      })
      .catch(() => {})
  }

  function handleQueuePlay(index: number) {
    queue.setCurrentIndex(index)
    const track = queue.tracks[index]
    if (track) handlePlayTrack(track, true)
  }

  // ── SFX handlers ─────────────────────────────────────────────────────

  function handlePlaySfx(sfxId: string, label: string, filename: string, loop?: boolean) {
    sfxPlayer.play(sfxId, label, filename, loop)
    window.doty.recordPlay(sfxId, 'sfx').catch(() => {})
  }

  function toggleSfxPin(sfxId: string) {
    setSfxPinned((prev) => (prev.includes(sfxId) ? prev.filter((f) => f !== sfxId) : [...prev, sfxId]))
  }

  function handleSfxTagsChange(filename: string, tags: string[]) {
    window.doty
      .setTags(filename, tags)
      .then(() => {
        setSfxTagsMap((prev) => ({ ...prev, [filename]: tags }))
        window.doty
          .getAllTags()
          .then(setSfxAllTags)
          .catch(() => {})
      })
      .catch(() => {})
  }

  // ── Derived data ─────────────────────────────────────────────────────

  // Music: recommendations minus pinned
  const suggestions = recommendations.filter((f) => !pinned.includes(f))
  const hasTracks = pinned.length > 0 || suggestions.length > 0

  // SFX: pinned SFX objects
  const sfxPinnedSet = new Set(sfxPinned)
  const pinnedSfxItems = useMemo(
    () => sfxPinned.map((id) => allSfx.find((s) => s.id === id)).filter((s): s is SfxMeta => !!s),
    [sfxPinned, allSfx],
  )

  // SFX: recommended minus pinned
  const sfxSuggestions = useMemo(() => {
    const recSet = new Set(sfxRecommendations)
    return allSfx
      .filter((s) => recSet.has(s.id) && !sfxPinnedSet.has(s.id))
      .sort((a, b) => sfxRecommendations.indexOf(a.id) - sfxRecommendations.indexOf(b.id))
  }, [allSfx, sfxRecommendations, sfxPinnedSet])

  // SFX: active channel map
  const activeChannelMap = useMemo(() => {
    const map = new Map<string, (typeof sfxPlayer.channels)[0]>()
    for (const ch of sfxPlayer.channels) map.set(ch.sfxId, ch)
    return map
  }, [sfxPlayer.channels])

  const hasActiveSfx = sfxPlayer.channels.length > 0
  const hasSfx = pinnedSfxItems.length > 0 || sfxSuggestions.length > 0

  const queuePosition: [number, number] | null =
    queue.tracks.length > 0 ? [queue.currentIndex, queue.tracks.length] : null

  // ── SFX card renderer ────────────────────────────────────────────────

  function renderSfxCard(sfx: SfxMeta) {
    const ch = activeChannelMap.get(sfx.id)
    return (
      <SfxCard
        key={sfx.id}
        sfx={sfx}
        channelId={ch?.id ?? null}
        isPlaying={!!ch?.playing}
        isLooping={ch?.looping ?? false}
        isPinned={sfxPinnedSet.has(sfx.id)}
        channelVolume={ch?.volume ?? sfxPlayer.getSfxVolume(sfx.id)}
        tags={sfxTagsMap[sfx.filename] || []}
        allTags={sfxAllTags}
        onPlay={(loop) => handlePlaySfx(sfx.id, sfx.label, sfx.filename, loop)}
        onStop={() => ch && sfxPlayer.stop(ch.id)}
        onToggleLoop={() => ch && sfxPlayer.toggleLoop(ch.id)}
        onVolumeChange={(v) => {
          sfxPlayer.setSfxVolume(sfx.id, v)
        }}
        onPin={() => toggleSfxPin(sfx.id)}
        onTagsChange={(tags) => handleSfxTagsChange(sfx.filename, tags)}
      />
    )
  }

  // ── Empty state helper ───────────────────────────────────────────────

  const emptyState = (msg: string, sub?: string, color = '#6b4e15') => (
    <div className="flex-1 flex flex-col items-center justify-center relative" style={{ minHeight: '120px' }}>
      <p
        style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', color, letterSpacing: '0.15em', textAlign: 'center' }}
      >
        {msg}
      </p>
      {sub && (
        <button
          onClick={onNoFolder}
          style={{
            marginTop: '8px',
            fontSize: '13px',
            color: '#c8922a',
            fontFamily: "'Cinzel', serif",
            letterSpacing: '0.1em',
            opacity: 0.7,
          }}
        >
          {sub}
        </button>
      )}
    </div>
  )

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col relative">
      {/* Two-column layout */}
      <div className="flex-1 min-h-0 flex gap-4 overflow-hidden">
        {/* ── Left column: Music ──────────────────────────────────────── */}
        <div className={`flex flex-col min-h-0 overflow-hidden ${showMusic ? 'flex-1' : 'shrink-0'}`}>
          {/* Music column header */}
          <div className="flex items-center justify-between mb-2 shrink-0">
            <button className="flex items-center gap-1.5" onClick={() => setShowMusic((v) => !v)}>
              <MusicNoteIcon />
              <span
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: '13px',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: '#c8922a',
                }}
              >
                Music
              </span>
              <span style={{ color: '#3a2e1a', marginLeft: '2px' }}>{showMusic ? <ChevronDown /> : <ChevronUp />}</span>
            </button>
            {showMusic && (
              <div className="flex items-center gap-2">
                {hasTracks && (
                  <span style={{ fontSize: '11px', color: '#3a2e1a', fontFamily: 'monospace' }}>
                    {pinned.length > 0 ? `${pinned.length} pinned` : ''}
                    {pinned.length > 0 && suggestions.length > 0 ? ' / ' : ''}
                    {suggestions.length > 0 ? `${suggestions.length} attuned` : ''}
                  </span>
                )}
                {musicFolder && (
                  <button
                    onClick={() => setBrowsing(true)}
                    className="p-1 hover:opacity-80 transition-opacity"
                    title="Browse all tracks"
                    style={{ border: '1px solid #2e2416' }}
                  >
                    <BrowseIcon />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Music content — scrollable, hidden when collapsed */}
          {showMusic &&
            (!musicFolder ? (
              emptyState('No archive selected', 'Open Configuration')
            ) : !hasTracks ? (
              emptyState('No tracks found')
            ) : (
              <div className="flex-1 min-h-0 flex flex-col gap-px overflow-y-auto">
                {/* Pinned section */}
                {pinned.length > 0 && (
                  <div className="flex items-center gap-2 shrink-0" style={{ height: '20px' }}>
                    <PinIcon filled />
                    <span
                      style={{
                        fontFamily: "'Cinzel', serif",
                        fontSize: '11px',
                        letterSpacing: '0.2em',
                        color: '#6b4e15',
                        textTransform: 'uppercase',
                      }}
                    >
                      Pinned
                    </span>
                    <div className="flex-1 h-px" style={{ background: 'rgba(200,146,42,0.15)' }} />
                  </div>
                )}
                {pinned.map((f, i) => (
                  <TrackCard
                    key={`pin-${f}`}
                    filename={f}
                    isPlaying={playing === f}
                    isPinned
                    showReorder
                    canMoveUp={i > 0}
                    canMoveDown={i < pinned.length - 1}
                    meta={metaMap[f]}
                    tags={tagsMap[f] || []}
                    allTags={allTags}
                    onPlay={() => handlePlayTrack(f)}
                    onPin={() => togglePin(f)}
                    onMoveUp={() => movePin(f, -1)}
                    onMoveDown={() => movePin(f, 1)}
                    onTagsChange={(tags) => handleTagsChange(f, tags)}
                    onPlayNext={() => queue.playNext(f)}
                    onAddToQueue={() => queue.enqueue(f)}
                  />
                ))}

                {/* Suggestions section */}
                {suggestions.length > 0 && (
                  <div className="flex items-center gap-2 shrink-0" style={{ height: '20px' }}>
                    <span style={{ fontSize: '10px', color: '#3a2e1a' }}>&#x2B21;</span>
                    <span
                      style={{
                        fontFamily: "'Cinzel', serif",
                        fontSize: '11px',
                        letterSpacing: '0.2em',
                        color: '#3a2e1a',
                        textTransform: 'uppercase',
                      }}
                    >
                      Suggestions
                    </span>
                    <div className="flex-1 h-px" style={{ background: 'rgba(46,36,22,0.5)' }} />
                  </div>
                )}
                {suggestions.map((f) => (
                  <TrackCard
                    key={`sug-${f}`}
                    filename={f}
                    isPlaying={playing === f}
                    isPinned={false}
                    showReorder={false}
                    canMoveUp={false}
                    canMoveDown={false}
                    meta={metaMap[f]}
                    tags={tagsMap[f] || []}
                    allTags={allTags}
                    onPlay={() => handlePlayTrack(f)}
                    onPin={() => togglePin(f)}
                    onMoveUp={() => {}}
                    onMoveDown={() => {}}
                    onTagsChange={(tags) => handleTagsChange(f, tags)}
                    onPlayNext={() => queue.playNext(f)}
                    onAddToQueue={() => queue.enqueue(f)}
                  />
                ))}
              </div>
            ))}
        </div>

        {/* ── Right column: SFX ───────────────────────────────────────── */}
        <div className={`flex flex-col min-h-0 overflow-hidden ${showSfx ? 'flex-1' : 'shrink-0'}`}>
          {/* SFX column header */}
          <div className="flex items-center justify-between mb-2 shrink-0">
            <button className="flex items-center gap-1.5" onClick={() => setShowSfx((v) => !v)}>
              <SfxIcon />
              <span
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: '13px',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: '#4a8a6a',
                }}
              >
                SFX
              </span>
              <span style={{ color: '#3a2e1a', marginLeft: '2px' }}>{showSfx ? <ChevronDown /> : <ChevronUp />}</span>
            </button>
            {showSfx && (
              <div className="flex items-center gap-2">
                {allSfx.length > 0 && (
                  <span style={{ fontSize: '11px', color: '#3a2e1a', fontFamily: 'monospace' }}>
                    {sfxPinned.length > 0 ? `${sfxPinned.length} pinned` : ''}
                    {sfxPinned.length > 0 && hasActiveSfx ? ' / ' : ''}
                    {hasActiveSfx ? `${sfxPlayer.channels.length} active` : ''}
                  </span>
                )}
                {hasActiveSfx && (
                  <button
                    onClick={sfxPlayer.stopAll}
                    className="p-1 hover:opacity-80 transition-opacity"
                    title="Stop all effects"
                    style={{ border: '1px solid rgba(74,138,106,0.3)', color: '#4a8a6a' }}
                  >
                    <StopIcon />
                  </button>
                )}
                {allSfx.length > 0 && (
                  <button
                    onClick={() => setBrowsingSfx(true)}
                    className="p-1 hover:opacity-80 transition-opacity"
                    title="Browse all effects"
                    style={{ border: '1px solid rgba(74,138,106,0.3)', color: '#4a8a6a' }}
                  >
                    <BrowseIcon />
                  </button>
                )}
              </div>
            )}
          </div>

          {showSfx && (
            <>
              {/* Active channels strip */}
              {hasActiveSfx && (
                <div className="mb-2 shrink-0">
                  <div className="flex items-center gap-1 overflow-x-auto pb-1">
                    {sfxPlayer.channels.map((ch) => (
                      <div
                        key={ch.id}
                        className="flex items-center gap-1.5 px-2 py-1 shrink-0"
                        style={{
                          background: 'rgba(74,138,106,0.08)',
                          border: '1px solid rgba(74,138,106,0.25)',
                          fontSize: '11px',
                          fontFamily: "'Crimson Text', serif",
                          color: '#a8d5b8',
                        }}
                      >
                        {ch.looping && <span style={{ fontSize: '8px', color: '#4a8a6a' }}>&#x21BB;</span>}
                        <span className="truncate" style={{ maxWidth: '80px' }}>
                          {ch.label}
                        </span>
                        <button
                          onClick={() => sfxPlayer.stop(ch.id)}
                          className="w-3 h-3 flex items-center justify-center hover:opacity-80"
                          style={{ color: '#4a8a6a' }}
                        >
                          <svg
                            className="w-2.5 h-2.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                          >
                            <path d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Master volume */}
              <div className="flex items-center gap-2 mb-2 shrink-0">
                <span
                  style={{
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    color: '#3a2e1a',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                  }}
                >
                  SFX Vol
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(sfxPlayer.masterVolume * 100)}
                  onChange={(e) => sfxPlayer.setMasterVolume(Number(e.target.value) / 100)}
                  className="flex-1"
                  style={{ accentColor: '#4a8a6a', height: '2px' }}
                  aria-label="SFX master volume"
                />
                <span
                  style={{
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    color: '#3a2e1a',
                    minWidth: '28px',
                    textAlign: 'right',
                  }}
                >
                  {Math.round(sfxPlayer.masterVolume * 100)}%
                </span>
              </div>

              {/* SFX content — scrollable */}
              {allSfx.length === 0 ? (
                emptyState('No sound effects available', undefined, '#4a8a6a')
              ) : !hasSfx ? (
                emptyState('No pinned or suggested effects', undefined, '#4a8a6a')
              ) : (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {/* Pinned SFX */}
                  {pinnedSfxItems.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 shrink-0 mb-1" style={{ height: '20px' }}>
                        <PinIcon filled />
                        <span
                          style={{
                            fontFamily: "'Cinzel', serif",
                            fontSize: '11px',
                            letterSpacing: '0.2em',
                            color: '#4a8a6a',
                            textTransform: 'uppercase',
                          }}
                        >
                          Pinned
                        </span>
                        <div className="flex-1 h-px" style={{ background: 'rgba(74,138,106,0.15)' }} />
                      </div>
                      <div className="grid grid-cols-2 gap-1 mb-2">{pinnedSfxItems.map(renderSfxCard)}</div>
                    </>
                  )}

                  {/* Suggested SFX */}
                  {sfxSuggestions.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 shrink-0 mb-1" style={{ height: '20px' }}>
                        <span style={{ fontSize: '10px', color: '#3a2e1a' }}>&#x2B21;</span>
                        <span
                          style={{
                            fontFamily: "'Cinzel', serif",
                            fontSize: '11px',
                            letterSpacing: '0.2em',
                            color: '#3a2e1a',
                            textTransform: 'uppercase',
                          }}
                        >
                          Suggested
                        </span>
                        <div className="flex-1 h-px" style={{ background: 'rgba(46,36,22,0.5)' }} />
                      </div>
                      <div className="grid grid-cols-2 gap-1">{sfxSuggestions.map(renderSfxCard)}</div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Overlays ──────────────────────────────────────────────────── */}

      {/* Browse all music tracks */}
      {browsing && musicFolder && (
        <BrowsePanel
          pinned={pinned}
          playing={playing}
          tagsMap={tagsMap}
          allTags={allTags}
          onPlay={playTrack}
          onPin={togglePin}
          onClose={() => setBrowsing(false)}
        />
      )}

      {/* Browse all SFX */}
      {browsingSfx && (
        <SfxBrowsePanel
          sfxRecommendations={sfxRecommendations}
          sfxPinned={sfxPinned}
          onTogglePin={toggleSfxPin}
          onClose={() => setBrowsingSfx(false)}
        />
      )}

      {/* Queue panel */}
      {showQueue && (
        <QueuePanel
          tracks={queue.tracks}
          currentIndex={queue.currentIndex}
          playing={playing}
          isPlaying={isAudioPlaying}
          onPlay={handleQueuePlay}
          onRemove={queue.remove}
          onReorder={queue.reorder}
          onClear={queue.clear}
          onClose={() => setShowQueue(false)}
        />
      )}

      {/* Persistent player bar */}
      {playing && (
        <PlayerBar
          filename={playing}
          isPlaying={isAudioPlaying}
          progress={progress}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          muted={muted}
          loopMode={loopMode}
          queuePosition={queuePosition}
          onToggle={() => playTrack(playing)}
          onSeek={seekTo}
          onSeekStart={seekStart}
          onSeekEnd={seekEnd}
          onVolumeChange={setVolume}
          onToggleMute={toggleMute}
          onCycleLoop={cycleLoopMode}
          onSkipNext={queue.tracks.length > 0 ? handleSkipNext : undefined}
          onSkipPrev={queue.tracks.length > 0 ? handleSkipPrev : undefined}
          onToggleQueue={() => setShowQueue((q) => !q)}
        />
      )}
    </div>
  )
}
