import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { useAutopilot } from '../hooks/useAutopilot'
import { useQueue } from '../hooks/useQueue'
import type { RankerType } from '../hooks/useRanker'
import { useSfxPlayer } from '../hooks/useSfxPlayer'
import { HIGHLIGHT_CONFIDENCE } from '../lib/autopilot'
import { describeTrack } from '../lib/rankTracks'
import type { DecisionLogEntry, SfxMeta, TrackMeta } from '../types'
import BrowsePanel from './BrowsePanel'
import DecisionLog from './DecisionLog'
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
  /** The DM is driving by hand; the ranker stays idle until they resume. */
  override: boolean
  onManualAction: () => void
  onResumeAuto: () => void
  sfxRecommendations: string[]
  lastConfidence: number
  /** TypeSafe choice confidence: how settled the pick is across the candidates. */
  lastChoiceConfidence: number
  /** Per-file probability, aligned with the suggestions. */
  probabilities: Record<string, number>
  /** Every candidate the model ranked, best first. */
  candidates: string[]
  /** The transcript window the director decides on. */
  sessionText: string
  lastRanker: RankerType
  /** Whether the decision model is loaded, loading, or failed. */
  rankerStatus: 'loading' | 'ready' | 'error'
  lastTranscriptSnippet: string
  musicFolder: string
  speakerDeviceId?: string
  settingsOpen: boolean
  onNoFolder: () => void
}

export default function Soundboard({
  override,
  onManualAction,
  onResumeAuto,
  recommendations,
  sfxRecommendations,
  lastConfidence,
  lastChoiceConfidence,
  probabilities,
  candidates,
  sessionText,
  lastRanker,
  rankerStatus,
  lastTranscriptSnippet,
  musicFolder,
  speakerDeviceId,
  settingsOpen,
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

  // ── Decision log (beta) ──────────────────────────────────────────────
  const [showDecisionLog, setShowDecisionLog] = useState(false)
  const [scene, setScene] = useState<string | null>(null)
  // Skips read the scene from an event handler, so they need it through a ref.
  const sceneRef = useRef<string | null>(null)
  useEffect(() => {
    sceneRef.current = scene
  }, [scene])
  const [report, setReport] = useState<{ autoActions: number; manualPicks: number; overrideRate: number } | null>(null)
  const sessionStartedAt = useRef(Date.now())
  /** Guards against queueing the same pick on every pass while a track is ending. */
  const lastQueued = useRef<{ track: string; at: number } | null>(null)
  const decisionLogRef = useRef<DecisionLogEntry[]>([])
  const [decisionLog, setDecisionLog] = useState<DecisionLogEntry[]>([])
  const lastAutoLogEntryRef = useRef<object | null>(null)

  // Accumulate decision log entries from recommendation results
  useEffect(() => {
    if (recommendations.length === 0 && lastConfidence === 0) return
    const entry: DecisionLogEntry = {
      timestamp: Date.now(),
      ranker: lastRanker,
      confidence: lastConfidence,
      topTrack: recommendations[0] ?? null,
      transcriptSnippet: lastTranscriptSnippet,
    }
    decisionLogRef.current = [entry, ...decisionLogRef.current].slice(0, 50)
    setDecisionLog([...decisionLogRef.current])
  }, [recommendations, lastConfidence, lastRanker, lastTranscriptSnippet])

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
        if (track) {
          playTrack(track, true)
          autopilot.notePlayed(track)
        } else stopPlayback()
      } else {
        stopPlayback()
      }
    }
  }, [queue, loopMode, playTrack, stopPlayback])

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

  // Load SFX list on mount and whenever the folder changes
  useEffect(() => {
    const load = () =>
      window.doty
        .getSfxList()
        .then(setAllSfx)
        .catch(() => setAllSfx([]))
    load()
    return window.doty.onSfxChanged(load)
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
  /**
   * Every manual playback change is both a decision and a label. Skips are weak
   * labels (rejection, not preference), queue picks are strong ones.
   */
  function recordPreference(track: string) {
    window.doty
      .sessionPreference({ at: Date.now(), segment: sessionText, track, scene: sceneRef.current, source: 'manual' })
      .catch(() => {})
  }

  function recordSkip(track: string) {
    onManualAction()
    window.doty
      .sessionDecision({
        at: Date.now(),
        kind: 'music',
        action: 'play-now',
        reason: 'the DM skipped',
        track,
        probability: 0,
        mood: sceneRef.current,
        source: 'manual',
      })
      .then(refreshReport)
      .catch(() => {})
  }

  function handleSkipNext() {
    if (queue.tracks.length === 0) return
    const track = queue.next(loopMode === 'queue')
    if (track) {
      playTrack(track, true)
      autopilot.notePlayed(track)
      recordSkip(track)
      recordPreference(track)
    }
  }

  function handleSkipPrev() {
    if (queue.tracks.length === 0) return
    const track = queue.prev(loopMode === 'queue')
    if (track) {
      playTrack(track, true)
      autopilot.notePlayed(track)
      recordSkip(track)
    }
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
    // biome-ignore lint/correctness/useExhaustiveDependencies: handleSkipNext/handleSkipPrev use refs internally
  }, [queue.tracks.length, handleSkipNext, handleSkipPrev]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Music handlers ───────────────────────────────────────────────────

  function handlePlayTrack(filename: string, forceRestart?: boolean, source: 'manual' | 'auto' = 'manual') {
    playTrack(filename, forceRestart)
    window.doty.recordPlay(filename, 'music').catch(() => {})
    autopilot.notePlayed(filename)
    // An automatic change is not the DM taking over: latching override here would
    // switch the director off on its own first cut.
    if (source === 'auto') return
    onManualAction()
    // Every manual pick is a label: what the DM chose for this moment.
    window.doty
      .sessionPreference({ at: Date.now(), segment: sessionText, track: filename, scene, source: 'manual' })
      .catch(() => {})
    window.doty
      .sessionDecision({
        at: Date.now(),
        kind: 'music',
        action: 'play-now',
        reason: 'the DM picked this',
        track: filename,
        probability: 0,
        mood: scene,
        source: 'manual',
      })
      .then(refreshReport)
      .catch(() => {})
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
    const track = queue.tracks[index]
    if (!track) return
    recordPreference(track)
    onManualAction()
    queue.setCurrentIndex(index)
    if (playing === track) {
      // Same track — toggle pause/resume (matches the pause icon in the queue)
      playTrack(track)
    } else {
      handlePlayTrack(track, true)
    }
  }

  // ── SFX handlers ─────────────────────────────────────────────────────

  function handlePlaySfx(sfxId: string, label: string, filename: string, loop?: boolean) {
    sfxPlayer.play(sfxId, label, filename, loop)
    window.doty.recordPlay(sfxId, 'sfx').catch(() => {})
    onManualAction()
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

  // ── Autopilot ─────────────────────────────────────────────────────────

  // Track when the current track started playing (for autopilot min-play check)
  const trackStartTimeRef = useRef<number | null>(null)
  const [trackStartTime, setTrackStartTime] = useState<number | null>(null)
  useEffect(() => {
    if (playing) {
      const now = Date.now()
      trackStartTimeRef.current = now
      setTrackStartTime(now)
    } else {
      trackStartTimeRef.current = null
      setTrackStartTime(null)
    }
  }, [playing])

  const autopilot = useAutopilot(
    playing,
    trackStartTime,
    pinned,
    (track) => {
      console.log('[autopilot] auto-playing:', track)
      playTrack(track, true)
      window.doty.recordPlay(track, 'music').catch(() => {})
    },
    (sfxId, volume) => {
      console.log('[autopilot] auto-triggering SFX:', sfxId, 'volume:', volume)
      const sfx = allSfx.find((s) => s.id === sfxId)
      if (sfx) {
        const channelId = sfxPlayer.play(sfxId, sfx.label, sfx.filename, false)
        // Per-trigger gain only — never overwrite the DM's saved SFX volume
        if (channelId) sfxPlayer.setChannelVolume(channelId, volume)
        window.doty.recordPlay(sfxId, 'sfx').catch(() => {})
      }
    },
    sfxPlayer.channels.length > 0,
    override,
  )

  // Reload autopilot config when Settings modal closes
  const prevSettingsOpenRef = useRef(settingsOpen)
  useEffect(() => {
    if (prevSettingsOpenRef.current && !settingsOpen) {
      autopilot.reloadConfig()
    }
    prevSettingsOpenRef.current = settingsOpen
  }, [settingsOpen, autopilot.reloadConfig])

  // The director: main owns the scene and the policy, this only executes the plan.
  // Player timing lives in refs so the effect does not re-run every quarter second.
  const playerRef = useRef({ currentTime, duration })
  const autopilotRef = useRef(autopilot.enabled)
  useEffect(() => {
    playerRef.current = { currentTime, duration }
  }, [currentTime, duration])
  useEffect(() => {
    autopilotRef.current = autopilot.enabled
  }, [autopilot.enabled])

  /** Crossing into the last 21 s of a track is its own trigger: silence at the table
   *  must not mean the boundary goes unplanned. */
  const nearEnd = duration > 0 && duration - currentTime <= 21

  const refreshReport = useCallback(() => {
    window.doty
      .sessionReport(sessionStartedAt.current)
      .then((r) => setReport({ autoActions: r.autoActions, manualPicks: r.manualPicks, overrideRate: r.overrideRate }))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshReport()
  }, [refreshReport])

  useEffect(() => {
    if (lastRanker !== 'model' || candidates.length === 0 || !sessionText) return
    let cancelled = false
    const { currentTime: at, duration: total } = playerRef.current
    const remaining = total > 0 ? Math.max(0, (total - at) * 1000) : null

    window.doty
      .sessionEvaluate({
        state: sessionText,
        // The model judges descriptions, not filenames: paths alone hide the tags,
        // BPM and energy that make a track recognisable.
        candidates: candidates.map((f) => describeTrack(f, metaMap[f], tagsMap[f] || [])),
        paths: candidates,
        msUntilTrackEnd: remaining,
        autopilot: autopilotRef.current,
        override,
      })
      .then(({ tracks, plan }) => {
        if (cancelled || !plan) return
        setScene(plan.scene)
        refreshReport()
        if (plan.action === 'hold') return

        let best = 0
        for (let i = 1; i < tracks.length; i++) if (tracks[i] > tracks[best]) best = i
        // Main resolves the path from the description it ranked; fall back to the
        // index when it did not.
        const track = plan.track ?? candidates[best]
        if (!track) return

        const recordAuto = (probability: number) =>
          window.doty
            .sessionDecision({
              at: Date.now(),
              kind: 'music',
              action: plan.action,
              reason: plan.reason,
              track,
              probability,
              mood: plan.scene,
              source: 'auto',
            })
            .then(refreshReport)
            .catch(() => {})

        if (plan.action === 'queue-next') {
          // Nothing playing yet: queueing would sit silent.
          if (!playing) {
            handlePlayTrack(track, true, 'auto')
            recordAuto(tracks[best] ?? 0)
            return
          }
          // Dedupe on what is actually in the queue, not on the last pick: the top
          // candidate flips between passes and would be queued repeatedly.
          if (queue.tracks.includes(track)) return
          const already = lastQueued.current
          if (already && already.track === track && Date.now() - already.at < 120_000) return
          lastQueued.current = { track, at: Date.now() }
          queue.playNext(track)
          recordAuto(tracks[best] ?? 0)
        } else {
          lastQueued.current = null
          handlePlayTrack(track, true, 'auto')
          recordAuto(tracks[best] ?? 0)
        }
      })
      .catch((e) => console.error('[director] evaluate failed:', e))
    return () => {
      cancelled = true
    }
    // handlePlayTrack and queue are stable enough for this one-shot planner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, lastRanker, sessionText, override, nearEnd, refreshReport, metaMap, tagsMap])

  // Feed confidence to autopilot when recommendations change.
  // Keep the callbacks in refs: they are rebuilt every render, so depending on
  // them directly would re-fire this effect (and its state writes) forever.
  const onRecommendationRef = useRef(autopilot.onRecommendation)
  const onSfxRecommendationRef = useRef(autopilot.onSfxRecommendation)
  onRecommendationRef.current = autopilot.onRecommendation
  onSfxRecommendationRef.current = autopilot.onSfxRecommendation

  useEffect(() => {
    if (recommendations.length > 0 && lastConfidence > 0) {
      onRecommendationRef.current(recommendations[0], lastConfidence)
    }
  }, [recommendations, lastConfidence])

  // Feed SFX recommendations to autopilot
  useEffect(() => {
    if (sfxRecommendations.length > 0) {
      onSfxRecommendationRef.current(sfxRecommendations)
    }
  }, [sfxRecommendations])

  // Merge autopilot decision log entries into the visible log
  useEffect(() => {
    // The source array is capped and prepend-only; use the last merged object
    // identity so entries sharing a millisecond are not dropped.
    const apLog = autopilot.decisionLog
    const lastIdx = lastAutoLogEntryRef.current ? apLog.indexOf(lastAutoLogEntryRef.current as never) : -1
    const newEntries = lastIdx === -1 ? apLog : apLog.slice(0, lastIdx)
    if (newEntries.length === 0) return
    lastAutoLogEntryRef.current = apLog[0]
    const mapped: DecisionLogEntry[] = newEntries.map((e) => ({
      timestamp: e.time,
      ranker: null,
      confidence: e.confidence,
      topTrack: e.candidate || null,
      transcriptSnippet: '',
      action: e.action,
      reason: e.reason,
    }))
    decisionLogRef.current = [...mapped, ...decisionLogRef.current].slice(0, 50)
    setDecisionLog([...decisionLogRef.current])
  }, [autopilot.decisionLog])

  // ── Derived data ─────────────────────────────────────────────────────

  // Music: recommendations minus pinned
  const suggestions = recommendations.filter((f) => !pinned.includes(f))
  // Everything else the model ranked, so all of its options are inspectable.
  const considered =
    lastRanker === 'model' ? candidates.filter((f) => !suggestions.includes(f) && !pinned.includes(f)) : []
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
          type="button"
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
          {autopilot.pendingTransition && (
            <div
              className="flex items-center gap-2 shrink-0 mb-2 px-2 py-1"
              data-testid="autopilot-countdown"
              style={{ border: '1px solid rgba(200,146,42,0.45)', background: 'rgba(200,146,42,0.06)' }}
            >
              <span style={{ fontSize: '11px', color: '#c8922a', fontFamily: 'monospace' }}>
                autopilot switches in {autopilot.pendingTransition.countdown}s
              </span>
              <span className="flex-1 min-w-0 truncate" style={{ fontSize: '11px', color: '#8a7050' }}>
                {autopilot.pendingTransition.track.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')}
              </span>
              <button
                type="button"
                onClick={autopilot.cancelTransition}
                style={{
                  fontSize: '10px',
                  fontFamily: 'monospace',
                  color: '#6b4e15',
                  border: '1px solid rgba(107,78,21,0.4)',
                  padding: '0 4px',
                }}
              >
                KEEP CURRENT
              </button>
            </div>
          )}

          {/* Music column header */}
          <div className="flex items-center justify-between mb-2 shrink-0">
            <button type="button" className="flex items-center gap-1.5" onClick={() => setShowMusic((v) => !v)}>
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
              {autopilot.enabled && autopilot.config.musicEnabled && (
                <span
                  data-testid="autopilot-chip"
                  title={`Autopilot changes the track by itself when the top suggestion passes ${Math.round(
                    autopilot.config.confidenceThreshold * 100,
                  )}%. Below that it only shows the suggestion.`}
                  style={{
                    fontSize: '9px',
                    color: autopilot.state === 'idle' ? '#6b4e15' : '#c8922a',
                    border: `1px solid ${autopilot.state === 'idle' ? 'rgba(107,78,21,0.4)' : 'rgba(200,146,42,0.5)'}`,
                    padding: '1px 4px',
                    fontFamily: 'monospace',
                    letterSpacing: '0.1em',
                  }}
                >
                  AUTO ≥{Math.round(autopilot.config.confidenceThreshold * 100)}%
                </span>
              )}
              <span style={{ color: '#3a2e1a', marginLeft: '2px' }}>{showMusic ? <ChevronDown /> : <ChevronUp />}</span>
            </button>
            {showMusic && (
              <div className="flex items-center gap-2">
                {hasTracks && (
                  <span style={{ fontSize: '11px', color: '#3a2e1a', fontFamily: 'monospace' }}>
                    {pinned.length > 0 ? `${pinned.length} pinned` : ''}
                    {pinned.length > 0 && suggestions.length > 0 ? ' / ' : ''}
                    {suggestions.length > 0
                      ? lastRanker === 'model' && candidates.length > suggestions.length
                        ? `${suggestions.length} of ${candidates.length} ranked`
                        : `${suggestions.length} attuned`
                      : ''}
                  </span>
                )}
                {musicFolder && (
                  <button
                    type="button"
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
          {autopilot.pendingTransition && showMusic && (
            <div
              className="mb-2 shrink-0 flex items-center justify-between px-3 py-2"
              style={{
                background: 'rgba(200,146,42,0.08)',
                border: '1px solid rgba(200,146,42,0.3)',
                fontSize: '12px',
                fontFamily: "'Crimson Text', serif",
              }}
            >
              <span style={{ color: '#c8b07a' }}>
                Switching to{' '}
                <span style={{ color: '#c8922a' }}>
                  {autopilot.pendingTransition.track.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')}
                </span>{' '}
                in {autopilot.pendingTransition.countdown}s…
              </span>
              <button
                type="button"
                onClick={autopilot.cancelTransition}
                style={{
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  color: '#c8922a',
                  border: '1px solid rgba(200,146,42,0.3)',
                  padding: '2px 8px',
                  background: 'rgba(200,146,42,0.1)',
                }}
              >
                Cancel
              </button>
            </div>
          )}
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
                      {lastRanker === 'model' && lastConfidence >= HIGHLIGHT_CONFIDENCE && (
                        <span
                          style={{ color: '#c8922a', fontSize: '9px', fontFamily: 'monospace' }}
                          title={`Above ${Math.round(HIGHLIGHT_CONFIDENCE * 100)}% the suggestion is called out. Autopilot only acts above its own threshold.`}
                        >
                          {' '}
                          ▲ strong
                        </span>
                      )}
                    </span>
                    {/* Ranker + confidence badge */}
                    {lastRanker && (
                      <span
                        data-testid="ranker-badge"
                        style={{
                          fontSize: '9px',
                          fontFamily: 'monospace',
                          padding: '0 4px',
                          border: `1px solid ${lastRanker === 'model' ? 'rgba(200,146,42,0.35)' : 'rgba(107,78,21,0.25)'}`,
                          color: lastRanker === 'model' ? '#c8922a' : '#6b4e15',
                          letterSpacing: '0.05em',
                        }}
                        title={`Ranked by ${lastRanker}${lastChoiceConfidence > 0 ? ` — confidence ${(lastChoiceConfidence * 100).toFixed(1)}% (how settled the choice is; each card shows its own probability)` : ''}`}
                      >
                        {lastRanker === 'model'
                          ? 'model'
                          : rankerStatus === 'loading'
                            ? 'keywords · model loading'
                            : rankerStatus === 'error'
                              ? 'keywords · model failed'
                              : 'keywords'}
                        {lastRanker === 'model' &&
                          lastChoiceConfidence > 0 &&
                          ` ${(lastChoiceConfidence * 100).toFixed(0)}% conf`}
                      </span>
                    )}
                    {scene && (
                      <span
                        data-testid="session-scene"
                        style={{ fontSize: '9px', fontFamily: 'monospace', color: '#4a3a20' }}
                        title="The scene the director currently holds, after hysteresis"
                      >
                        scene · {scene}
                      </span>
                    )}
                    {report && (report.autoActions > 0 || report.manualPicks > 0) && (
                      <span
                        data-testid="session-report"
                        style={{ fontSize: '9px', fontFamily: 'monospace', color: '#4a3a20' }}
                        title="Automatic changes, manual picks, and the share of acted-on decisions the DM replaced"
                      >
                        auto {report.autoActions} · manual {report.manualPicks} · override{' '}
                        {Math.round(report.overrideRate * 100)}%
                      </span>
                    )}
                    {override && (
                      <button
                        type="button"
                        onClick={onResumeAuto}
                        title="Playback is yours until you resume automatic suggestions"
                        style={{
                          fontSize: '9px',
                          fontFamily: 'monospace',
                          padding: '0 4px',
                          border: '1px solid rgba(74,138,106,0.45)',
                          color: '#4a8a6a',
                          letterSpacing: '0.05em',
                        }}
                      >
                        RESUME AUTO
                      </button>
                    )}
                    <div className="flex-1 h-px" style={{ background: 'rgba(46,36,22,0.5)' }} />
                    {/* Decision log toggle */}
                    <button
                      type="button"
                      onClick={() => setShowDecisionLog((v) => !v)}
                      className="opacity-40 hover:opacity-100 transition-opacity"
                      title="Toggle decision log (beta)"
                      style={{
                        fontSize: '9px',
                        fontFamily: 'monospace',
                        color: showDecisionLog ? '#c8922a' : '#6b4e15',
                        border: `1px solid ${showDecisionLog ? 'rgba(200,146,42,0.4)' : 'rgba(107,78,21,0.2)'}`,
                        padding: '0 4px',
                        lineHeight: '16px',
                      }}
                    >
                      LOG
                    </button>
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
                    probability={lastRanker === 'model' ? probabilities[f] : undefined}
                    onPlay={() => handlePlayTrack(f)}
                    onPin={() => togglePin(f)}
                    onMoveUp={() => {}}
                    onMoveDown={() => {}}
                    onTagsChange={(tags) => handleTagsChange(f, tags)}
                    onPlayNext={() => queue.playNext(f)}
                    onAddToQueue={() => queue.enqueue(f)}
                  />
                ))}

                {/* Everything else the model ranked: all of its options are inspectable */}
                {considered.length > 0 && (
                  <div className="shrink-0 mt-1" data-testid="considered-list">
                    <div className="flex items-center gap-2" style={{ height: '18px' }}>
                      <span
                        style={{
                          fontFamily: "'Cinzel', serif",
                          fontSize: '10px',
                          letterSpacing: '0.2em',
                          color: '#2e2416',
                          textTransform: 'uppercase',
                        }}
                      >
                        also considered · {candidates.length} ranked
                      </span>
                      <div className="flex-1 h-px" style={{ background: 'rgba(46,36,22,0.35)' }} />
                    </div>
                    <div className="overflow-y-auto" style={{ maxHeight: '168px' }}>
                      {considered.map((f) => (
                        <div key={`alt-${f}`} className="mb-1" style={{ opacity: 0.55 }}>
                          <TrackCard
                            filename={f}
                            isPlaying={playing === f}
                            isPinned={false}
                            showReorder={false}
                            canMoveUp={false}
                            canMoveDown={false}
                            meta={metaMap[f]}
                            tags={tagsMap[f] || []}
                            allTags={allTags}
                            probability={probabilities[f]}
                            onPlay={() => handlePlayTrack(f)}
                            onPin={() => togglePin(f)}
                            onMoveUp={() => {}}
                            onMoveDown={() => {}}
                            onTagsChange={(tags) => handleTagsChange(f, tags)}
                            onPlayNext={() => queue.playNext(f)}
                            onAddToQueue={() => queue.enqueue(f)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Decision log panel (beta) */}
                {showDecisionLog && (
                  <div className="shrink-0 mt-1">
                    <DecisionLog entries={decisionLog} onClose={() => setShowDecisionLog(false)} />
                  </div>
                )}
              </div>
            ))}
        </div>

        {/* ── Right column: SFX ───────────────────────────────────────── */}
        <div className={`flex flex-col min-h-0 overflow-hidden ${showSfx ? 'flex-1' : 'shrink-0'}`}>
          {/* SFX column header */}
          <div className="flex items-center justify-between mb-2 shrink-0">
            <button type="button" className="flex items-center gap-1.5" onClick={() => setShowSfx((v) => !v)}>
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
              {autopilot.enabled && autopilot.config.sfxEnabled && (
                <span
                  style={{
                    fontSize: '9px',
                    color: autopilot.lastAutoSfx ? '#4a8a6a' : '#2a5a3a',
                    border: `1px solid ${autopilot.lastAutoSfx ? 'rgba(74,138,106,0.5)' : 'rgba(74,138,106,0.3)'}`,
                    padding: '1px 4px',
                    fontFamily: 'monospace',
                    letterSpacing: '0.1em',
                    transition: 'all 0.3s ease',
                  }}
                >
                  AUTO
                </span>
              )}
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
                    type="button"
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
                    type="button"
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
                          type="button"
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

      {browsingSfx && (
        <SfxBrowsePanel
          sfxPlayer={sfxPlayer}
          sfxRecommendations={sfxRecommendations}
          sfxPinned={sfxPinned}
          onTogglePin={toggleSfxPin}
          onClose={() => setBrowsingSfx(false)}
        />
      )}

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
