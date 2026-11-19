import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { useAutopilot } from '../hooks/useAutopilot'
import { useQueue } from '../hooks/useQueue'
import type { RankerType } from '../hooks/useRanker'
import { useSfxPlayer } from '../hooks/useSfxPlayer'
import { HIGHLIGHT_CONFIDENCE } from '../lib/autopilot'
import { formatTime } from '../lib/formatTime'
import { indexChipText } from '../lib/indexStatus'
import { skipTarget } from '../lib/queueSkip'
import { describeTrack } from '../lib/rankTracks'
import { trackEndPlan } from '../lib/trackEnd'
import { trackKindOf } from '../lib/trackKind'
import type { DecisionLogEntry, IndexProgress, SessionReport, SfxMeta, TrackMeta } from '../types'
import BrowsePanel from './BrowsePanel'
import DecisionLog from './DecisionLog'
import {
  BrowseIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LoopSmallIcon,
  MusicNoteIcon,
  PinIcon,
  SfxIcon,
  StopIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeMutedIcon,
} from './Icons'
import PlayerBar, { trackName } from './PlayerBar'
import QueuePanel from './QueuePanel'
import RecommendCard, { musicDetails, sfxDetails } from './RecommendCard'
import SfxBrowsePanel from './SfxBrowsePanel'
import VolumePopover from './VolumePopover'

const PINS_KEY = 'doty:pinnedTracks'
const SFX_PINS_KEY = 'doty:pinnedSfx'

/**
 * One rule for both shelves: as many cards per line as the pane's width allows.
 * The two columns are the same width, so they always show the same shape.
 */
const CARD_GRID: React.CSSProperties = { gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))' }

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

/** Slim side rail shown in place of a collapsed column; click to expand it again. */
function CollapsedRail({
  label,
  color,
  borderColor,
  icon,
  count,
  onExpand,
}: {
  label: string
  color: string
  borderColor: string
  icon: ReactNode
  count: number
  onExpand: () => void
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      title={`Expand ${label} column`}
      className="flex-1 flex flex-col items-center gap-3 py-3 hover:opacity-80 transition-opacity"
      style={{ border: `1px solid ${borderColor}`, color }}
    >
      {icon}
      <span
        style={{
          writingMode: 'vertical-rl',
          fontFamily: "'Cinzel', serif",
          fontSize: '11px',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      {count > 0 && <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' }}>{count}</span>}
    </button>
  )
}

/** A list section's title and its hairline, the same in both columns. */
function SectionHeading({
  mark,
  label,
  rule,
  children,
}: {
  mark?: ReactNode
  label: string
  rule: string
  children?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 shrink-0 mb-1 mt-1" style={{ height: '24px' }}>
      {mark}
      <span className="label-caps">{label}</span>
      <div className="flex-1 h-px" style={{ background: rule }} />
      {children}
    </div>
  )
}

/** A small text button for a card's hover toolbar. */
function CardAction({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="px-1.5 py-0.5 hover:opacity-80 transition-opacity shrink-0"
      style={{
        fontSize: '11px',
        fontFamily: "'IBM Plex Mono', monospace",
        color: 'var(--accent-dim)',
        border: '1px solid rgba(200,146,42,0.2)',
        lineHeight: '14px',
      }}
    >
      {children}
    </button>
  )
}

interface Props {
  recommendations: string[]
  /** The effects the column offers: the model's ranking, best first. */
  sfxRecommendations: string[]
  /** Every effect the model ranked, best first: what the column did not suggest. */
  sfxCandidates?: string[]
  /** Per-effect probability, aligned with `sfxCandidates`. */
  sfxProbabilities?: Record<string, number>
  /** The `sfxRecommendations` the model was sure enough about for autopilot to fire. */
  sfxAutopilot: string[]
  lastConfidence: number
  /** Per-file probability, aligned with the suggestions. */
  probabilities: Record<string, number>
  /** Every candidate the model ranked, best first. */
  candidates: string[]
  /** The transcript window the director decides on. */
  sessionText: string
  lastRanker: RankerType
  /** Whether the decision model is loaded, loading, or failed. */
  rankerStatus: 'loading' | 'ready' | 'error'
  /** How far the library index has got; null until the first status arrives. */
  indexStatus: IndexProgress | null
  lastTranscriptSnippet: string
  musicFolder: string
  speakerDeviceId?: string
  settingsOpen: boolean
  /** The header's master switch: with it off nothing changes on its own. */
  /** When the current (or last) recording started; the session report counts from here. */
  sessionStartTime: number | null
  /** The decision model is still arriving: say so instead of "no model". */
  rankerDownloading: boolean
  autopilotEnabled: boolean
  onNoFolder: () => void
}

export default function Soundboard({
  recommendations,
  sfxRecommendations,
  sfxCandidates = [],
  sfxProbabilities = {},
  sfxAutopilot,
  lastConfidence,
  probabilities,
  candidates,
  sessionText,
  lastRanker,
  rankerStatus,
  indexStatus,
  lastTranscriptSnippet,
  musicFolder,
  speakerDeviceId,
  settingsOpen,
  sessionStartTime,
  rankerDownloading,
  autopilotEnabled,
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

  // The queue is an overlay like the browse panes; Escape must close it too.
  useEffect(() => {
    if (!showQueue) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowQueue(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showQueue])

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
  /** Tracks moved to the other library in this session: hide them until the next pass. */
  const [movedAway, setMovedAway] = useState<string[]>([])
  // Skips read the scene from an event handler, so they need it through a ref.
  const sceneRef = useRef<string | null>(null)
  useEffect(() => {
    sceneRef.current = scene
  }, [scene])
  const [report, setReport] = useState<SessionReport | null>(null)
  const sessionStartedAt = useRef(Date.now())
  // The header owns the real clock: mount time is only a fallback before the
  // first recording, and the anchor stays after stop so the report keeps its meaning.
  useEffect(() => {
    if (sessionStartTime) sessionStartedAt.current = sessionStartTime
  }, [sessionStartTime])
  /** Guards against queueing the same pick on every pass while a track is ending. */
  /**
   * An automatic pick waiting at the boundary. The decision row is written when
   * the track actually starts, not when it is queued: retention counts skips
   * within 30 s of playback, and a queue can sit for a whole track first.
   */
  const lastQueued = useRef<{
    track: string
    queuedAt: number
    action: string
    reason: string
    probability: number
    scene: string | null
  } | null>(null)
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

  const refreshReport = useCallback(() => {
    window.doty
      .sessionReport(sessionStartedAt.current)
      .then(setReport)
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshReport()
  }, [refreshReport])

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
      const plan = trackEndPlan({
        tracks: queue.tracks,
        currentIndex: queue.currentIndex,
        playing,
        loopMode,
      })
      if (!plan) {
        stopPlayback()
        return
      }

      const start = (track: string) => {
        const queued = lastQueued.current
        if (queued && queued.track === track) {
          lastQueued.current = null
          // The queued pick is the automatic change; this is its real start.
          window.doty
            .sessionDecision({
              at: Date.now(),
              kind: 'music',
              action: queued.action,
              reason: queued.reason,
              track,
              probability: queued.probability,
              mood: queued.scene,
              source: 'auto',
            })
            .then(refreshReport)
            .catch(() => {})
        }
        playTrack(track, true)
        autopilot.notePlayed(track)
      }

      // Repeating a cue is not a new pick: no play-frequency bump and no decision.
      if (plan.index === null) {
        playTrack(plan.track, true)
        return
      }

      queue.setCurrentIndex(plan.index)
      start(plan.track)
    }
  }, [queue, loopMode, playing, playTrack, stopPlayback, refreshReport])

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

  // Load SFX list on mount and whenever the shelf can have changed. A scan and the
  // audio pass re-resolve every lane, and a suggestion computed from the new shelf
  // cannot render against the list from before it.
  useEffect(() => {
    const load = () =>
      window.doty
        .getSfxList()
        .then(setAllSfx)
        .catch(() => setAllSfx([]))
    load()
    const offSfx = window.doty.onSfxChanged(load)
    const offScan = window.doty.onScanComplete(load)
    return () => {
      offSfx()
      offScan()
    }
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
  /** A skip is a label: the DM moved off this track for this kind of scene. */
  function recordRejection(track: string) {
    window.doty
      .sessionPreference({ at: Date.now(), segment: sessionText, track, scene: sceneRef.current, source: 'reject' })
      .catch(() => {})
  }

  function recordSkip(track: string) {
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

  /**
   * Move one row in the queue and start it. The label belongs to the track the
   * DM is leaving — the loaded one — never to whatever row the queue's index
   * happened to point at while something outside the queue was playing.
   */
  function skipInQueue(step: 1 | -1) {
    const tracks = queue.tracks
    if (tracks.length === 0) return
    // Index -1 means what plays is outside the queue: either direction starts at
    // the head rather than wrapping to the tail.
    let target = queue.currentIndex < 0 ? 0 : skipTarget(queue.currentIndex, tracks.length, step, loopMode === 'queue')
    // Once the queue has run out, the player is gone and N should start it again.
    if (target < 0 && !playing && step === 1) target = 0
    if (target < 0) return
    const track = tracks[target]
    const skipped = playing ?? undefined
    queue.setCurrentIndex(target)
    playTrack(track, true)
    autopilot.notePlayed(track)
    if (skipped && skipped !== track) {
      recordSkip(skipped)
      recordRejection(skipped)
    }
  }

  function handleSkipNext() {
    skipInQueue(1)
  }

  function handleSkipPrev() {
    skipInQueue(-1)
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
    // The queue's "current" must name the track actually playing. Playing a card
    // outside the queue clears it, so the player never claims a position in a
    // list that has nothing to do with what the DM hears.
    queue.setCurrentIndex(queue.tracks.indexOf(filename))
    // An automatic change is not a label: only the DM's own pick is what they
    // chose for this moment.
    if (source === 'auto') return
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
    if (playing === track) {
      // Same track — toggle pause/resume (matches the pause icon in the queue).
      // Transport is not a pick and must not write a preference.
      playTrack(track)
      return
    }
    // One pick, one label: `handlePlayTrack` records it.
    handlePlayTrack(track, true)
    queue.setCurrentIndex(index)
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
  const autopilotRef = useRef(autopilot.config.musicEnabled)
  useEffect(() => {
    playerRef.current = { currentTime, duration }
  }, [currentTime, duration])
  useEffect(() => {
    autopilotRef.current = autopilot.config.musicEnabled
  }, [autopilot.config.musicEnabled])

  /** Crossing into the last 21 s of a track is its own trigger: silence at the table
   *  must not mean the boundary goes unplanned. */
  const nearEnd = duration > 0 && duration - currentTime <= 21

  // The candidates array is rebuilt on every recommendation, even when the list is
  // the same. Key the pass on content so identical passes do not pay for the model
  // again while another one is still running.
  const candidateKey = candidates.join('\n')

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
        musicEnabled: autopilotEnabled && autopilotRef.current,
        confidenceThreshold: autopilot.config.confidenceThreshold,
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
          // The DM may have lined up the next track by hand. Their choice wins.
          if (queue.currentIndex >= 0 && queue.currentIndex < queue.tracks.length - 1) return
          const already = lastQueued.current
          if (already && already.track === track && Date.now() - already.queuedAt < 120_000) return
          lastQueued.current = {
            track,
            queuedAt: Date.now(),
            action: plan.action,
            reason: plan.reason,
            probability: tracks[best] ?? 0,
            scene: plan.scene,
          }
          queue.playNext(track)
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
  }, [
    candidateKey,
    lastRanker,
    sessionText,
    nearEnd,
    refreshReport,
    metaMap,
    tagsMap,
    autopilot.config.confidenceThreshold,
    autopilotEnabled,
  ])

  // Feed confidence to autopilot when recommendations change.
  // Keep the callbacks in refs: they are rebuilt every render, so depending on
  // them directly would re-fire this effect (and its state writes) forever.
  const onRecommendationRef = useRef(autopilot.onRecommendation)
  const onSfxRecommendationRef = useRef(autopilot.onSfxRecommendation)
  onRecommendationRef.current = autopilot.onRecommendation
  onSfxRecommendationRef.current = autopilot.onSfxRecommendation

  useEffect(() => {
    if (!autopilotEnabled) return
    if (recommendations.length === 0 || lastConfidence <= 0) return
    // The director owns music when the model is loaded: it changes at boundaries
    // and cuts in only on a categorical scene change. Feeding the legacy
    // threshold-driven autopilot as well would give two authorities and let it
    // replace a track mid-phrase.
    if (lastRanker === 'model') return
    onRecommendationRef.current(recommendations[0], lastConfidence)
  }, [recommendations, lastConfidence, lastRanker, autopilotEnabled])

  // Feed SFX recommendations to autopilot. Only the confident ones: the column
  // may offer five, but autopilot plays a sound nobody asked for.
  useEffect(() => {
    if (!autopilotEnabled) return
    if (sfxAutopilot.length > 0) {
      onSfxRecommendationRef.current(sfxAutopilot)
    }
  }, [sfxAutopilot, autopilotEnabled])

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
  const suggestions = recommendations.filter((f) => !pinned.includes(f) && !movedAway.includes(f))
  // Everything else the model ranked, so all of its options are inspectable.
  const considered =
    lastRanker === 'model'
      ? candidates.filter((f) => !suggestions.includes(f) && !pinned.includes(f) && !movedAway.includes(f))
      : []
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

  // SFX: everything else the model ranked, so its options are as inspectable as
  // the music column's. Before the model answers, the shortlist is unranked and
  // there is nothing honest to show under "also considered".
  const sfxConsidered = useMemo(() => {
    if (Object.keys(sfxProbabilities).length === 0) return []
    const recSet = new Set(sfxRecommendations)
    return sfxCandidates
      .filter((id) => !recSet.has(id) && !sfxPinnedSet.has(id))
      .map((id) => allSfx.find((s) => s.id === id))
      .filter((s): s is SfxMeta => !!s)
  }, [allSfx, sfxCandidates, sfxProbabilities, sfxRecommendations, sfxPinnedSet])

  // SFX: active channel map
  const activeChannelMap = useMemo(() => {
    const map = new Map<string, (typeof sfxPlayer.channels)[0]>()
    for (const ch of sfxPlayer.channels) map.set(ch.sfxId, ch)
    return map
  }, [sfxPlayer.channels])

  const hasActiveSfx = sfxPlayer.channels.length > 0
  const hasSfx = pinnedSfxItems.length > 0 || sfxSuggestions.length > 0

  // Only a real position in the queue counts: index -1 means the playing track
  // is outside it, and "0/2" would be nonsense.
  const queuePosition: [number, number] | null =
    queue.tracks.length > 0 && queue.currentIndex >= 0 ? [queue.currentIndex, queue.tracks.length] : null

  // ── Card renderers ───────────────────────────────────────────────────

  function renderSfxCard(sfx: SfxMeta, showProbability = true) {
    const ch = activeChannelMap.get(sfx.id)
    const volume = ch?.volume ?? sfxPlayer.getSfxVolume(sfx.id)
    const VolumeIcon = volume === 0 ? VolumeMutedIcon : volume < 0.5 ? VolumeLowIcon : VolumeHighIcon
    return (
      <RecommendCard
        key={sfx.id}
        kind="sfx"
        title={sfx.label}
        isPlaying={!!ch?.playing}
        isPinned={sfxPinnedSet.has(sfx.id)}
        probability={showProbability ? sfxProbabilities[sfx.id] : undefined}
        details={sfxDetails(sfx, sfxTagsMap[sfx.filename] || [])}
        tags={sfxTagsMap[sfx.filename] || []}
        allTags={sfxAllTags}
        onPlay={() => (ch?.playing ? sfxPlayer.stop(ch.id) : handlePlaySfx(sfx.id, sfx.label, sfx.filename))}
        onPin={() => toggleSfxPin(sfx.id)}
        onTagsChange={(tags) => handleSfxTagsChange(sfx.filename, tags)}
        actions={
          <>
            <button
              type="button"
              onClick={() =>
                ch?.playing ? sfxPlayer.toggleLoop(ch.id) : handlePlaySfx(sfx.id, sfx.label, sfx.filename, true)
              }
              className="w-5 h-5 flex items-center justify-center shrink-0 opacity-60 hover:opacity-100 transition-opacity"
              title={ch?.looping ? 'Stop looping' : 'Loop'}
              style={{ color: ch?.looping ? 'var(--rune)' : 'var(--ink-muted)' }}
            >
              <LoopSmallIcon />
            </button>
            <VolumePopover
              volume={volume}
              onVolumeChange={(v) => sfxPlayer.setSfxVolume(sfx.id, v)}
              VolumeIcon={VolumeIcon}
              accentColor="rgba(74,138,106,0.3)"
              label={`${sfx.label} volume`}
            />
          </>
        }
      />
    )
  }

  function renderTrack(f: string, opts: { pinned?: boolean; index?: number; probability?: number } = {}) {
    // The lane is a label the card shows, not the file's location: a track pulled
    // in from the effects folder is one click away from the right shelf.
    const isSfxFile = (metaMap[f]?.lane ?? trackKindOf(f, metaMap[f])) === 'sfx'
    return (
      <RecommendCard
        key={`${opts.pinned ? 'pin' : 'sug'}-${f}`}
        kind="music"
        title={trackName(f)}
        isPlaying={playing === f && isAudioPlaying}
        isPinned={!!opts.pinned}
        probability={opts.probability}
        details={musicDetails(f, metaMap[f])}
        tags={tagsMap[f] || []}
        allTags={allTags}
        onPlay={() => {
          // A pause/resume of the loaded track is transport, not a new pick.
          if (playing === f) playTrack(f)
          else handlePlayTrack(f)
        }}
        onPin={() => togglePin(f)}
        onTagsChange={(tags) => handleTagsChange(f, tags)}
        actions={
          <>
            {opts.pinned && (
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => movePin(f, -1)}
                  disabled={!opts.index}
                  className="p-1"
                  style={{ opacity: opts.index ? 1 : 0.3 }}
                  title="Move up"
                >
                  <ChevronUp />
                </button>
                <button
                  type="button"
                  onClick={() => movePin(f, 1)}
                  disabled={opts.index === pinned.length - 1}
                  className="p-1"
                  style={{ opacity: opts.index === pinned.length - 1 ? 0.3 : 1 }}
                  title="Move down"
                >
                  <ChevronDown />
                </button>
              </div>
            )}
            {!opts.pinned && (
              <button
                type="button"
                data-testid="move-track"
                onClick={() => {
                  window.doty.moveTrack(f, isSfxFile ? 'music' : 'sfx').then((r) => {
                    if (r.ok) setMovedAway((prev) => [...prev, f])
                  })
                }}
                title={isSfxFile ? 'Move to the music library' : 'Move to the effects library'}
                className="px-1 shrink-0 opacity-70 hover:opacity-100 transition-opacity"
                style={{ fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", color: 'var(--accent-dim)' }}
              >
                {isSfxFile ? '→ music' : '→ fx'}
              </button>
            )}
            <CardAction title="Play next" onClick={() => queue.playNext(f)}>
              NEXT
            </CardAction>
            <CardAction title="Add to queue" onClick={() => queue.enqueue(f)}>
              QUEUE
            </CardAction>
          </>
        }
      />
    )
  }

  // ── Empty state helper ───────────────────────────────────────────────

  const emptyState = (msg: string, sub?: string, color = '#a5813f') => (
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
            color: '#d9a441',
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
      <div className="flex-1 min-h-0 flex gap-4 overflow-hidden relative">
        {/* ── Left column: Music ──────────────────────────────────────── */}
        <div className={`flex flex-col min-h-0 min-w-0 overflow-hidden ${showMusic ? 'flex-1' : 'w-9 shrink-0'}`}>
          {!showMusic && (
            <CollapsedRail
              label="Music"
              color="#d9a441"
              borderColor="#3d2f1c"
              icon={<MusicNoteIcon />}
              count={pinned.length + suggestions.length}
              onExpand={() => setShowMusic(true)}
            />
          )}
          {showMusic && autopilot.pendingTransition && (
            <div
              className="flex items-center gap-2 shrink-0 mb-2 px-2 py-1"
              data-testid="autopilot-countdown"
              style={{ border: '1px solid rgba(200,146,42,0.45)', background: 'rgba(200,146,42,0.06)' }}
            >
              <span style={{ fontSize: '11px', color: '#d9a441', fontFamily: "'IBM Plex Mono', monospace" }}>
                autopilot switches in {autopilot.pendingTransition.countdown}s
              </span>
              <span className="flex-1 min-w-0 truncate" style={{ fontSize: '11px', color: '#b9a683' }}>
                {autopilot.pendingTransition.track.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')}
              </span>
              <button
                type="button"
                onClick={autopilot.cancelTransition}
                style={{
                  fontSize: '11px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: '#a5813f',
                  border: '1px solid rgba(107,78,21,0.4)',
                  padding: '0 4px',
                }}
              >
                KEEP CURRENT
              </button>
            </div>
          )}

          {/* Music column header */}
          <div
            className={`${showMusic ? 'flex' : 'hidden'} items-center justify-between flex-wrap gap-y-1 mb-3 shrink-0`}
          >
            <button type="button" className="flex items-center gap-2" onClick={() => setShowMusic((v) => !v)}>
              <MusicNoteIcon />
              <span
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: '14px',
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: '#d9a441',
                }}
              >
                Music
              </span>
              {autopilotEnabled && autopilot.config.musicEnabled && (
                <span
                  data-testid="autopilot-chip"
                  title={
                    lastRanker === 'model'
                      ? `At a track boundary autopilot changes the cue only when the top pick is clearly ahead; otherwise the current cue repeats. It cuts a track short only when the scene changes categorically and the top pick passes ${Math.round(
                          autopilot.config.confidenceThreshold * 100,
                        )}% with a clear margin.`
                      : 'The decision model is not installed, so autopilot follows keyword scores, not calibrated confidence. Install it in Settings for automatic changes.'
                  }
                  className="shrink-0 whitespace-nowrap"
                  style={{
                    fontSize: '11px',
                    color: autopilot.state === 'idle' ? '#a5813f' : '#d9a441',
                    border: `1px solid ${autopilot.state === 'idle' ? 'rgba(107,78,21,0.4)' : 'rgba(200,146,42,0.5)'}`,
                    padding: '1px 4px',
                    fontFamily: "'IBM Plex Mono', monospace",
                    letterSpacing: '0.1em',
                  }}
                >
                  {lastRanker === 'model' ? 'AUTO · when sure' : 'AUTO · keywords'}
                </span>
              )}
              <span style={{ color: '#9d8b66', marginLeft: '2px' }}>
                <ChevronLeft />
              </span>
            </button>
            {showMusic && (
              <div className="flex items-center gap-2 shrink-0">
                {hasTracks && (
                  <span
                    className="whitespace-nowrap"
                    style={{ fontSize: '11px', color: '#9d8b66', fontFamily: "'IBM Plex Mono', monospace" }}
                  >
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
                    className="p-1.5 hover:opacity-100 transition-opacity"
                    title="Browse all tracks"
                    aria-label="Browse all tracks"
                    style={{ border: '1px solid #7a6138', color: '#b9a683' }}
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
              <span style={{ color: '#e4d6b4' }}>
                Switching to{' '}
                <span style={{ color: '#d9a441' }}>
                  {autopilot.pendingTransition.track.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')}
                </span>{' '}
                in {autopilot.pendingTransition.countdown}s…
              </span>
              <button
                type="button"
                onClick={autopilot.cancelTransition}
                style={{
                  fontSize: '11px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: '#d9a441',
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
              <div className="flex-1 min-h-0 overflow-y-auto">
                {/* Pinned section */}
                {pinned.length > 0 && (
                  <>
                    <SectionHeading mark={<PinIcon filled />} label="Pinned" rule="rgba(200,146,42,0.15)" />
                    <div className="grid gap-1 mb-2" style={CARD_GRID}>
                      {pinned.map((f, i) => renderTrack(f, { pinned: true, index: i }))}
                    </div>
                  </>
                )}

                {/* Suggestions section */}
                {suggestions.length > 0 && (
                  <div
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 shrink-0 mt-1 mb-1"
                    style={{ minHeight: '28px' }}
                  >
                    <span style={{ fontSize: '11px', color: '#9d8b66' }}>&#x2B21;</span>
                    <span className="label-caps">
                      Suggestions
                      {lastRanker === 'model' && lastConfidence >= HIGHLIGHT_CONFIDENCE && (
                        <span
                          style={{ color: '#d9a441', fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace" }}
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
                          fontSize: '11px',
                          fontFamily: "'IBM Plex Mono', monospace",
                          padding: '0 4px',
                          border: `1px solid ${lastRanker === 'model' ? 'rgba(200,146,42,0.35)' : 'rgba(107,78,21,0.25)'}`,
                          color: lastRanker === 'model' ? '#d9a441' : '#a5813f',
                          letterSpacing: '0.05em',
                        }}
                        title={`Ranked by ${lastRanker}${lastConfidence > 0 ? ` — the first card's probability is ${(lastConfidence * 100).toFixed(0)}%` : ''}`}
                      >
                        {lastRanker === 'model'
                          ? 'model'
                          : rankerStatus === 'loading'
                            ? 'keywords · model loading'
                            : rankerStatus === 'error'
                              ? rankerDownloading
                                ? 'keywords · model downloading'
                                : 'keywords · no model'
                              : 'keywords'}
                        {lastRanker === 'model' && lastConfidence > 0 && ` ${(lastConfidence * 100).toFixed(0)}% conf`}
                      </span>
                    )}
                    {scene && (
                      <span
                        data-testid="session-scene"
                        style={{ fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", color: '#96825f' }}
                        title="The scene the director currently holds, after hysteresis"
                      >
                        scene · {scene}
                      </span>
                    )}
                    {report && (report.autoActions > 0 || report.manualPicks > 0) && (
                      <span
                        data-testid="session-report"
                        style={{ fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", color: '#96825f' }}
                        title="Automatic changes, manual picks, the share the DM replaced, the share of automatic picks kept, and when the DM first chose by hand"
                      >
                        auto {report.autoActions} · manual {report.manualPicks}
                        {report.autoActions > 0 && ` · override ${Math.round(report.overrideRate * 100)}%`}
                        {report.autoChangeRetention != null &&
                          ` · kept ${Math.round(report.autoChangeRetention * 100)}%`}
                        {report.timeToFirstManualPickMs != null &&
                          ` · first pick ${formatTime(report.timeToFirstManualPickMs / 1000)}`}
                      </span>
                    )}
                    {indexChipText(indexStatus) && (
                      <span
                        data-testid="index-chip"
                        style={{
                          fontSize: '11px',
                          fontFamily: "'IBM Plex Mono', monospace",
                          color: indexStatus?.paused ? '#b06a2a' : '#96825f',
                          border: '1px solid rgba(46,36,22,0.6)',
                          padding: '0 4px',
                        }}
                        title="The library is being embedded in the background; recording pauses it"
                      >
                        {indexChipText(indexStatus)}
                      </span>
                    )}
                    <div className="flex-1 h-px" style={{ background: 'rgba(46,36,22,0.5)' }} />
                    {/* Decision log toggle */}
                    <button
                      type="button"
                      onClick={() => setShowDecisionLog((v) => !v)}
                      className="opacity-80 hover:opacity-100 transition-opacity"
                      title="Toggle decision log (beta)"
                      aria-pressed={showDecisionLog}
                      style={{
                        fontSize: '11px',
                        fontFamily: "'IBM Plex Mono', monospace",
                        color: showDecisionLog ? '#d9a441' : '#b9a683',
                        border: `1px solid ${showDecisionLog ? 'rgba(217,164,65,0.5)' : '#7a6138'}`,
                        padding: '1px 6px',
                        lineHeight: '18px',
                      }}
                    >
                      LOG
                    </button>
                  </div>
                )}
                <div className="grid gap-1 mb-2" style={CARD_GRID}>
                  {suggestions.map((f) =>
                    renderTrack(f, { probability: lastRanker === 'model' ? probabilities[f] : undefined }),
                  )}
                </div>

                {/* Everything else the model ranked: all of its options are inspectable */}
                {considered.length > 0 && (
                  <div data-testid="considered-list">
                    <SectionHeading
                      label={`also considered · ${candidates.length} ranked`}
                      rule="rgba(122,97,56,0.25)"
                    />
                    <div className="grid gap-1" style={CARD_GRID}>
                      {considered.map((f) => renderTrack(f, { probability: probabilities[f] }))}
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
        <div className={`flex flex-col min-h-0 min-w-0 overflow-hidden ${showSfx ? 'flex-1' : 'w-9 shrink-0'}`}>
          {!showSfx && (
            <CollapsedRail
              label="SFX"
              color="#6dbf95"
              borderColor="rgba(74,138,106,0.3)"
              icon={<SfxIcon />}
              count={sfxPinned.length + sfxSuggestions.length}
              onExpand={() => setShowSfx(true)}
            />
          )}
          {/* SFX column header */}
          <div className={`${showSfx ? 'flex' : 'hidden'} items-center justify-between mb-3 shrink-0`}>
            <button type="button" className="flex items-center gap-2" onClick={() => setShowSfx((v) => !v)}>
              <SfxIcon />
              <span
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: '13px',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: '#6dbf95',
                }}
              >
                SFX
              </span>
              {autopilot.config.sfxEnabled && (
                <span
                  style={{
                    fontSize: '11px',
                    color: autopilot.lastAutoSfx ? '#6dbf95' : '#3f7d5c',
                    border: `1px solid ${autopilot.lastAutoSfx ? 'rgba(74,138,106,0.5)' : 'rgba(74,138,106,0.3)'}`,
                    padding: '1px 4px',
                    fontFamily: "'IBM Plex Mono', monospace",
                    letterSpacing: '0.1em',
                    transition: 'all 0.3s ease',
                  }}
                >
                  AUTO
                </span>
              )}
              <span style={{ color: '#9d8b66', marginLeft: '2px' }}>
                <ChevronRight />
              </span>
            </button>
            {showSfx && (
              <div className="flex items-center gap-2">
                {allSfx.length > 0 && (
                  <span style={{ fontSize: '11px', color: '#9d8b66', fontFamily: "'IBM Plex Mono', monospace" }}>
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
                    style={{ border: '1px solid rgba(74,138,106,0.3)', color: '#6dbf95' }}
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
                    style={{ border: '1px solid rgba(74,138,106,0.3)', color: '#6dbf95' }}
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
                        {ch.looping && <span style={{ fontSize: '8px', color: '#6dbf95' }}>&#x21BB;</span>}
                        <span className="truncate" style={{ maxWidth: '80px' }}>
                          {ch.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => sfxPlayer.stop(ch.id)}
                          className="w-3 h-3 flex items-center justify-center hover:opacity-80"
                          style={{ color: '#6dbf95' }}
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
                    fontSize: '11px',
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: '#9d8b66',
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
                  style={{ accentColor: '#6dbf95' }}
                  aria-label="SFX master volume"
                />
                <span
                  style={{
                    fontSize: '11px',
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: '#9d8b66',
                    minWidth: '28px',
                    textAlign: 'right',
                  }}
                >
                  {Math.round(sfxPlayer.masterVolume * 100)}%
                </span>
              </div>

              {/* SFX content — scrollable */}
              {allSfx.length === 0 ? (
                emptyState('No sound effects available', undefined, '#6dbf95')
              ) : !hasSfx ? (
                emptyState('No pinned or suggested effects', undefined, '#6dbf95')
              ) : (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {/* Pinned SFX */}
                  {pinnedSfxItems.length > 0 && (
                    <>
                      <SectionHeading mark={<PinIcon filled />} label="Pinned" rule="rgba(74,138,106,0.15)" />
                      <div className="grid gap-1 mb-2" style={CARD_GRID}>
                        {pinnedSfxItems.map((sfx) => renderSfxCard(sfx, false))}
                      </div>
                    </>
                  )}

                  {/* Suggested SFX */}
                  {sfxSuggestions.length > 0 && (
                    <>
                      <SectionHeading
                        mark={<span style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>&#x2B21;</span>}
                        label="Suggested"
                        rule="rgba(122,97,56,0.25)"
                      />
                      <div className="grid gap-1 mb-2" style={CARD_GRID}>
                        {sfxSuggestions.map((sfx) => renderSfxCard(sfx))}
                      </div>
                    </>
                  )}

                  {/* Everything else the model ranked, as in the music column */}
                  {sfxConsidered.length > 0 && (
                    <div data-testid="sfx-considered">
                      <SectionHeading
                        label={`also considered · ${sfxCandidates.length} ranked`}
                        rule="rgba(122,97,56,0.25)"
                      />
                      <div className="grid gap-1" style={CARD_GRID}>
                        {sfxConsidered.map((sfx) => renderSfxCard(sfx))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Inside the shelves, so the transport below stays clickable while open. */}
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
      </div>
      {browsing && musicFolder && (
        <BrowsePanel
          pinned={pinned}
          playing={playing}
          tagsMap={tagsMap}
          allTags={allTags}
          onPlay={(f) => (playing === f ? playTrack(f) : handlePlayTrack(f))}
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
