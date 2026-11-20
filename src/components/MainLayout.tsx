import { useCallback, useEffect, useRef, useState } from 'react'
import { type RankerType, type RecommendResult, useRanker } from '../hooks/useRanker'
import { useRecorder } from '../hooks/useRecorder'
import { type ContextConfig, composeState, DEFAULT_CONTEXT } from '../lib/context'
import { heuristicSfxRecommend } from '../lib/heuristicSfxRecommend'
import { countWords, MIN_NEW_WORDS, shouldRecommend, waitBeforeRecommending } from '../lib/recommendCadence'
import { confidentSfx, mergeSfxCandidates, rankAllSfx } from '../lib/sfxRank'
import { speakerPrefix } from '../lib/speaker'
import { stableOrder } from '../lib/stableOrder'
import type { IndexProgress } from '../types'
import { EyeIcon, EyeOffIcon, GearIcon } from './Icons'
import LightPanel from './LightPanel'
import Settings from './Settings'
import Soundboard from './Soundboard'
import type { TranscriptSegment } from './Transcript'
import Transcript from './Transcript'
import UpdateBar from './UpdateBar'

/** Long enough that typing a sentence never decides on half of it. */
const DM_IDLE_MS = 900

const MIC_STORAGE_KEY = 'doty:micDeviceId'
const SPEAKER_STORAGE_KEY = 'doty:speakerDeviceId'

export default function MainLayout() {
  const [recording, setRecording] = useState(false)
  const [asrStatus, setAsrStatus] = useState<'idle' | 'loading' | 'ready' | 'crashed'>('idle')
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([])
  const [interimText, setInterimText] = useState('')
  const [recommendations, setRecommendations] = useState<string[]>([])
  const [lastConfidence, setLastConfidence] = useState(0)
  const [probabilities, setProbabilities] = useState<Record<string, number>>({})
  const [candidates, setCandidates] = useState<string[]>([])
  const [lastTranscriptSnippet, setLastTranscriptSnippet] = useState('')
  /** The transcript window the director reads: wider than the UI snippet. */
  const [sessionText, setSessionText] = useState('')
  const [indexStatus, setIndexStatus] = useState<IndexProgress | null>(null)
  const [settingsSection, setSettingsSection] = useState<'audio' | 'library' | 'transcription' | 'director'>('library')
  const [sfxRecommendations, setSfxRecommendations] = useState<string[]>([])
  /** Every effect the model ranked, best first: the column shows the rest under it. */
  const [sfxCandidates, setSfxCandidates] = useState<string[]>([])
  const [sfxProbabilities, setSfxProbabilities] = useState<Record<string, number>>({})
  /** The subset the model was sure enough about for autopilot to play unasked. */
  const [sfxAutopilot, setSfxAutopilot] = useState<string[]>([])
  const [showSettings, setShowSettings] = useState(false)
  /**
   * The master switch, persisted: Doty changes nothing on its own until the DM
   * turns this on, and it stays on (or off) across relaunches.
   */
  const [autopilotEnabled, setAutopilotEnabled] = useState(false)
  const [musicFolder, setMusicFolder] = useState('')
  const [micDeviceId, setMicDeviceId] = useState<string | undefined>(
    () => localStorage.getItem(MIC_STORAGE_KEY) ?? undefined,
  )
  const [speakerDeviceId, setSpeakerDeviceId] = useState<string | undefined>(
    () => localStorage.getItem(SPEAKER_STORAGE_KEY) ?? undefined,
  )
  const [dmPrompt, setDmPrompt] = useState('')
  const [rankerCached, setRankerCached] = useState<boolean | null>(null)
  const [rankerDownloading, setRankerDownloading] = useState(false)
  const [recommendCount, setRecommendCount] = useState(5)
  const [showTranscript, setShowTranscript] = useState(true)
  const transcriptBufferRef = useRef('')
  /** The budget the models read by; the ref keeps a callback from closing over an old value. */
  const [context, setContext] = useState<ContextConfig>(DEFAULT_CONTEXT)
  const contextRef = useRef<ContextConfig>(DEFAULT_CONTEXT)
  /** The last SFX query and when it ran: the same text is not re-ranked on a loop. */
  const sfxLastText = useRef('')
  const sfxLastAt = useRef(0)
  const [sessions, setSessions] = useState<Array<{ file: string; name: string; created: string }>>([])
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null)
  const [_reprocessProgress, setReprocessProgress] = useState<number | null>(null)
  const [_reprocessingFile, setReprocessingFile] = useState<string | null>(null)
  const [sttModelList, setSttModelList] = useState<Array<{ id: string; label: string; ready: boolean }>>([])
  const [sttReady, setSttReady] = useState<boolean | null>(null)
  const [sttDownload, setSttDownload] = useState<{ modelId: string; percent: number } | null>(null)
  const [sttDownloadError, setSttDownloadError] = useState<string | null>(null)

  // Speech model availability + background download progress
  useEffect(() => {
    const loadModelList = () =>
      window.doty
        .getSttModelList()
        .then((list) => setSttModelList(list.map((m) => ({ id: m.id, label: m.label, ready: m.ready }))))

    loadModelList()
    window.doty.modelStatus().then(({ ready }) => setSttReady(ready))
    window.doty.getSttDownloadState().then(({ downloading, error }) => {
      setSttDownload(downloading)
      setSttDownloadError(error?.error ?? null)
    })

    const unsubStatus = window.doty.onModelStatus(({ ready }) => {
      setSttReady(ready)
      if (ready) {
        setSttDownload(null)
        setSttDownloadError(null)
        loadModelList()
      }
    })
    const unsubProgress = window.doty.onModelProgress((p) => {
      setSttDownloadError(null)
      setSttDownload({ modelId: p.modelId ?? '', percent: p.percent })
    })
    const unsubDownloadError = window.doty.onModelDownloadError(({ error }) => setSttDownloadError(error))
    const unsubCancelled = window.doty.onModelDownloadCancelled(() => {
      setSttDownload(null)
      setSttDownloadError(null)
    })
    return () => {
      unsubStatus()
      unsubProgress()
      unsubDownloadError()
      unsubCancelled()
    }
  }, [])
  const recommendDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** What the last recommendation was based on, for the two cadence gates. */
  const lastRunRef = useRef({ at: 0, words: 0 })
  const dmDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const interimDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The prompt the shelf is following; empty means the transcript owns it. */
  const dmPromptRef = useRef('')
  /** What the DM is looking at now: the pick only changes for a real margin. */
  const displayedTopRef = useRef<string | null>(null)
  /** Monotonic tokens: an older answer may not paint over a newer one. */
  const dmSeq = useRef(0)
  const recSeq = useRef(0)
  const lastDmApplied = useRef(0)
  const lastRecApplied = useRef(0)
  const sfxSeq = useRef(0)
  const lastSfxApplied = useRef(0)
  const appliedRankerRef = useRef<RankerType>(null)
  const [dmBusy, setDmBusy] = useState(false)
  /** The ranker behind the list on screen: not the model's latest, transient answer. */
  const [appliedRanker, setAppliedRanker] = useState<RankerType>(null)
  const recommendCountRef = useRef(recommendCount)
  const [sfxRecommendCount, setSfxRecommendCount] = useState(5)
  const sfxRecommendCountRef = useRef(sfxRecommendCount)
  const { start, stop, micPermission } = useRecorder(micDeviceId)
  const { recommend, modelStatus } = useRanker()
  const recommendRef = useRef(recommend)
  // Stable handle for the IPC effect below (a plain function is rebuilt every render)
  const toggleRecordingRef = useRef<() => void>(() => {})
  toggleRecordingRef.current = toggleRecording

  // A different folder or session is a different scene: no held pick crosses it.
  useEffect(() => {
    displayedTopRef.current = null
  }, [musicFolder, activeSession])

  // Keep refs in sync with latest values
  useEffect(() => {
    recommendCountRef.current = recommendCount
  }, [recommendCount])
  useEffect(() => {
    recommendRef.current = recommend
  }, [recommend])
  useEffect(() => {
    sfxRecommendCountRef.current = sfxRecommendCount
  }, [sfxRecommendCount])

  /** Store the DM's experiment surface and adopt whatever bounds main enforces. */
  const applyContext = useCallback((next: ContextConfig) => {
    setContext(next)
    contextRef.current = next
    window.doty
      .setContext(next)
      .then((saved) => {
        setContext(saved)
        contextRef.current = saved
      })
      .catch(() => {})
  }, [])

  /**
   * A loaded session is the room's recent past: seed the window from it. Without
   * this a new session starts with the previous session's last words still in it.
   * The seed is not trimmed to the window — the next cue trims it — so a stored
   * window the mount fetch has not delivered yet cannot truncate it.
   */
  const seedBuffer = useCallback((texts: string[]) => {
    transcriptBufferRef.current = texts.filter(Boolean).join(' ')
    // The cadence gate counts words since the last ranking; a new buffer is a new
    // zero, or the difference goes negative and no line ever triggers a ranking.
    lastRunRef.current = { at: Date.now(), words: countWords(transcriptBufferRef.current) }
  }, [])

  // Load recommendation count, context budget and the autopilot master switch on mount
  useEffect(() => {
    window.doty.getRecommendationCount().then(setRecommendCount)
    window.doty.getSfxRecommendationCount().then(setSfxRecommendCount)
    window.doty.getAutopilotConfig().then((cfg) => setAutopilotEnabled(cfg.enabled))
    window.doty.getContext().then((c) => {
      setContext(c)
      contextRef.current = c
    })
  }, [])

  // Load sessions and restore last active session on mount
  useEffect(() => {
    async function loadSessions() {
      const list = await window.doty.sessionList()
      setSessions(list)
      const last = await window.doty.sessionGetLast()
      if (last) {
        setActiveSession(last)
        const cues = await window.doty.sessionLoad(last)
        setTranscripts(cues.map((c) => ({ text: c.text, elapsedMs: 0, speaker: c.speaker })))
        seedBuffer(cues.map((c) => c.text))
      } else if (list.length === 0) {
        // Auto-create first session
        const s = await window.doty.sessionCreate()
        setSessions([s])
        setActiveSession(s.file)
      } else {
        setActiveSession(list[0].file)
        const cues = await window.doty.sessionLoad(list[0].file)
        setTranscripts(cues.map((c) => ({ text: c.text, elapsedMs: 0, speaker: c.speaker })))
        seedBuffer(cues.map((c) => c.text))
      }
    }
    loadSessions()
  }, [seedBuffer])

  // Tell the main process which session new transcript cues belong to.
  // (session:load only records the last *viewed* session.)
  useEffect(() => {
    if (activeSession) window.doty.sessionSetActive(activeSession)
  }, [activeSession])

  // Subscribe to reprocess events
  useEffect(() => {
    const unsubProgress = window.doty.onReprocessProgress((p) => setReprocessProgress(p.percent))
    const unsubDone = window.doty.onReprocessDone(async (r) => {
      setReprocessProgress(null)
      setReprocessingFile(null)
      // Reload the session if it's the active one
      if (r.file === activeSession) {
        const cues = await window.doty.sessionLoad(r.file)
        setTranscripts(cues.map((c) => ({ text: c.text, elapsedMs: 0, speaker: c.speaker })))
        seedBuffer(cues.map((c) => c.text))
      }
    })
    const unsubError = window.doty.onReprocessError(() => {
      setReprocessProgress(null)
      setReprocessingFile(null)
    })
    return () => {
      unsubProgress()
      unsubDone()
      unsubError()
    }
  }, [activeSession, seedBuffer])

  // Check if the ranker model is already on disk on mount
  useEffect(() => {
    window.doty.rankerStatus().then(({ cached, downloading }) => {
      setRankerCached(cached)
      setRankerDownloading(downloading)
    })
    const unsubRankerDownload = window.doty.onRankerDownloadProgress((p) => {
      setRankerDownloading(p.status === 'downloading')
      if (p.status === 'done') setRankerCached(true)
    })
    return unsubRankerDownload
  }, [])

  // Once model is ready, mark as cached so the banner doesn't reappear
  useEffect(() => {
    if (modelStatus === 'ready') setRankerCached(true)
  }, [modelStatus])

  const showRankerMissing = rankerCached === false && modelStatus !== 'ready'

  /** One place decides what the shelf shows, so every path gets the same stability. */
  const showRanking = useCallback((result: RecommendResult) => {
    // The first model answer replaces the keyword list whole; hysteresis is for
    // later model answers, not for keeping a keyword guess over a real score.
    if (result.ranker === 'model' && appliedRankerRef.current !== 'model') displayedTopRef.current = null
    const ordered = stableOrder(result.files, result.probabilities, displayedTopRef.current)
    const top = ordered[0] ?? null
    displayedTopRef.current = top
    appliedRankerRef.current = result.ranker
    setRecommendations(ordered)
    // The headline confidence must describe the card that is actually first.
    setLastConfidence(top ? (result.probabilities[top] ?? result.confidence) : result.confidence)
    setProbabilities(result.probabilities)
    setCandidates(result.candidates)
    setAppliedRanker(result.ranker)
  }, [])

  const runRecommendation = useCallback(async () => {
    // A typed prompt owns the shelf. Doing the work and throwing it away only
    // queues behind the DM's answer in the same worker.
    if (dmPromptRef.current.trim()) return
    const run = ++recSeq.current
    const files = await window.doty.listMusic()
    console.log('[recommend] runRecommendation called, files:', files.length)
    if (files.length === 0) {
      console.log('[recommend] no files, skipping')
      return
    }
    const recentTranscript = transcriptBufferRef.current.slice(-contextRef.current.rankerChars).trim()
    const state = recentTranscript
    console.log(
      '[recommend] transcript context:',
      recentTranscript.length,
      'chars, preview:',
      recentTranscript.slice(0, 80),
    )
    const result = await recommendRef.current(state, files, recommendCountRef.current)
    // The DM prompt owns the shelf while it is set. An answer that started
    // earlier may still land later; it only loses to a newer answer of the same
    // kind, so the list can refine but never revert.
    if (dmPromptRef.current.trim() || run < lastRecApplied.current) return
    lastRecApplied.current = run
    console.log('[recommend] results:', result.files.length, result.files, 'confidence:', result.confidence)
    showRanking(result)
    setLastTranscriptSnippet(recentTranscript.slice(-120))
    setSessionText(state)
    lastRunRef.current = { at: Date.now(), words: countWords(transcriptBufferRef.current) }
  }, [showRanking])

  const runSfxRecommendation = useCallback(async (overrideText?: string) => {
    // Every recommendation re-sends the same DM text. Re-ranking it within a few
    // seconds returns the same answer and adds work to the worker queue that the
    // director's music pass is waiting in.
    const text = overrideText ?? transcriptBufferRef.current.slice(-contextRef.current.sfxChars).trim()
    // With a prompt set, the effects column follows the prompt, not the room.
    if (!overrideText && dmPromptRef.current.trim()) return
    if (text === sfxLastText.current && Date.now() - sfxLastAt.current < 5_000) return
    const run = ++sfxSeq.current
    sfxLastText.current = text
    sfxLastAt.current = Date.now()
    const sfxList = await window.doty.getSfxList()
    console.log('[sfx-recommend] sfxList:', sfxList.length, 'items')
    if (sfxList.length === 0) {
      console.log('[sfx-recommend] no SFX available, skipping')
      return
    }
    const tagsMap = await window.doty.getTagsMap()
    const playFrequencies = await window.doty.getPlayFrequencies('sfx')
    console.log('[sfx-recommend] text:', JSON.stringify(text.slice(0, 80)), 'count:', sfxRecommendCountRef.current)
    const count = sfxRecommendCountRef.current
    const results = heuristicSfxRecommend(text, sfxList, count, tagsMap, playFrequencies)

    // Keywords cannot answer a concept: "air" is in no mood profile and no label,
    // so the heuristic falls back to history and offers a monster roar. The index
    // can answer it — the same one the search box uses — so both lists go to the
    // model, which is the only thing that can tell which of them fits the scene.
    const hits = text.trim() ? await window.doty.librarySearch(text, 'sfx', count).catch(() => null) : null
    const byFile = new Map(sfxList.map((s) => [s.filename, s.id]))
    const nearest = (hits?.items ?? []).map((hit) => byFile.get(hit.absolute)).filter((id): id is string => !!id)
    const candidates = mergeSfxCandidates(nearest, results, count)
    console.log('[sfx-recommend] candidates:', candidates.length, { nearest, heuristic: results })
    // An older run may not paint over a newer one, and only the run that painted
    // the shortlist may apply its own model ranking.
    if (run < lastSfxApplied.current) return
    lastSfxApplied.current = run
    setSfxRecommendations(candidates)
    setSfxCandidates(candidates)
    setSfxProbabilities({})

    // The model decides when a sound is worth firing; the shortlist only narrows
    // what it chooses between. A missing model leaves the shortlist and nothing
    // for autopilot.
    if (!text.trim()) {
      setSfxAutopilot([])
      return
    }
    const descriptions = candidates.map((id) => {
      const sfx = sfxList.find((s) => s.id === id)
      const tags = (tagsMap[id] ?? []).join(', ')
      return [sfx?.label ?? id, tags].filter(Boolean).join(' — ')
    })
    if (descriptions.length === 0) return
    await window.doty
      .sfxRank(text, descriptions)
      .then((probabilities) => {
        if (run !== lastSfxApplied.current) return
        // The column shows the model's ranking — nothing fires from it, so a
        // second-best suggestion costs the DM one glance. Autopilot is the part
        // that must be sure: it plays a sound nobody asked for.
        const ranked = rankAllSfx(candidates, probabilities)
        setSfxRecommendations(ranked.slice(0, count).map((c) => c.path))
        setSfxCandidates(ranked.map((c) => c.path))
        setSfxProbabilities(Object.fromEntries(ranked.map((c) => [c.path, c.probability])))
        setSfxAutopilot(confidentSfx(candidates, probabilities).map((c) => c.path))
      })
      .catch(() => {})
  }, [])

  const runDmRecommendation = useCallback(
    async (prompt: string) => {
      console.log('[recommend] runDmRecommendation called, prompt:', JSON.stringify(prompt))
      const run = ++dmSeq.current
      setDmBusy(true)
      try {
        const files = await window.doty.listMusic()
        console.log('[recommend] DM: files:', files.length)
        if (files.length === 0) {
          console.log('[recommend] DM: no files, skipping')
          return
        }
        // The DM's instruction heads the state; the room's last words follow it.
        // It used to be sent twice to weight it, which only spent the window.
        const budget = contextRef.current
        const combined = composeState(prompt, transcriptBufferRef.current, {
          hintChars: budget.hintChars,
          transcriptChars: budget.rankerChars,
        })
        console.log('[recommend] DM: combined query:', combined.length, 'chars, count:', recommendCountRef.current)
        const result = await recommendRef.current(combined, files, recommendCountRef.current)
        if (run < lastDmApplied.current) return
        lastDmApplied.current = run
        console.log('[recommend] DM: results:', result.files.length, result.files, 'confidence:', result.confidence)
        showRanking(result)
        setLastTranscriptSnippet(prompt.slice(-120))
        setSessionText(combined)
        // The effects ranker has its own budget: the same hint, less of the room.
        runSfxRecommendation(
          composeState(prompt, transcriptBufferRef.current, {
            hintChars: budget.hintChars,
            transcriptChars: budget.sfxChars,
          }),
        )
      } finally {
        // Still busy if the DM has typed something newer since this answer.
        if (run === dmSeq.current && dmPromptRef.current.trim() === prompt.trim()) setDmBusy(false)
      }
    },
    [runSfxRecommendation, showRanking],
  )

  // When music folder becomes available, trigger default recommendations
  useEffect(() => {
    if (musicFolder) {
      runRecommendation()
      runSfxRecommendation()
    }
  }, [musicFolder, runRecommendation, runSfxRecommendation])

  useEffect(() => {
    window.doty.getMusicFolder().then(setMusicFolder)

    const unsubTranscript = window.doty.onTranscript(({ text, elapsedMs, speaker }) => {
      setTranscripts((prev) => [...prev, { text, elapsedMs, speaker }])
      setInterimText('') // Clear interim when final arrives
      // The ranker reads the words, not the labels: "Ana:" is for the DM's eyes.
      transcriptBufferRef.current = `${transcriptBufferRef.current} ${text}`.slice(-contextRef.current.windowChars)
      // Debounce STT-triggered recommendations, then apply the cadence gates:
      // three new words, and two seconds since the last answer. A request that is
      // only too early is retried when the interval allows, not dropped, or a
      // long uninterrupted sentence would never refresh.
      if (recommendDebounceRef.current) clearTimeout(recommendDebounceRef.current)
      const maybeRecommend = () => {
        const wordsSince = countWords(transcriptBufferRef.current) - lastRunRef.current.words
        const msSince = Date.now() - lastRunRef.current.at
        if (!shouldRecommend(wordsSince, msSince)) {
          const wait = waitBeforeRecommending(msSince)
          if (wordsSince >= MIN_NEW_WORDS && wait > 0) {
            recommendDebounceRef.current = setTimeout(maybeRecommend, wait)
          }
          return
        }
        void runRecommendation()
      }
      recommendDebounceRef.current = setTimeout(maybeRecommend, contextRef.current.debounceMs)
      // Run SFX recommendations immediately — heuristic is cheap (~5ms) and
      // autopilot needs low latency for reactive SFX triggers (see #43)
      runSfxRecommendation()
    })

    // The index runs in the background for minutes; one subscription feeds the
    // browser chip and Settings without either polling. Subscribe before the
    // fetch, or an event during the round trip is overwritten by the snapshot.
    let sawIndexEvent = false
    const unsubIndex = window.doty.onEmbeddingProgress((status) => {
      sawIndexEvent = true
      setIndexStatus(status)
    })
    window.doty
      .embeddingStatus()
      .then((status) => {
        if (!sawIndexEvent) setIndexStatus(status)
      })
      .catch(() => {})

    const unsubSttStatus = window.doty.onSttStatus((status) => {
      if (status === 'crashed' || status === 'error') {
        setAsrStatus('crashed')
        setRecording(false)
        // Release the mic and reset main's recording state (open WAV fd, embedding pause)
        stop()
        window.doty.sttStop().catch(() => {})
      } else {
        setAsrStatus(status === 'loading' ? 'loading' : status === 'ready' ? 'ready' : 'idle')
      }
    })

    const unsubInterim = window.doty.onSttInterim((text) => {
      // Show streaming text immediately — no debounce for smooth typing feel
      setInterimText(text)
    })

    const unsubModelSwitch = window.doty.onSttModelSwitched((info) => {
      setTranscripts((prev) => [...prev, { text: `⟳ Switched to ${info.label}`, elapsedMs: 0, system: true }])
      setInterimText('')
    })

    const unsubParagraphBreak = window.doty.onParagraphBreak(() => {
      // Mark next segment as paragraph start
      setTranscripts((prev) => {
        if (prev.length === 0) return prev
        // Add a marker that the next segment starts a new paragraph
        const last = prev[prev.length - 1]
        if (last.system) return prev // don't double-break after system messages
        return [...prev, { text: '', elapsedMs: 0, paragraphStart: true }]
      })
    })

    // Folder/session changes coming from Settings or the main process
    const unsubFolder = window.doty.onMusicFolderChanged((folder) => setMusicFolder(folder))
    const unsubSessions = window.doty.onSessionsChanged(() => {
      window.doty.sessionList().then(setSessions)
      window.doty.sessionGetLast().then(async (last) => {
        if (!last) return
        setActiveSession(last)
        const cues = await window.doty.sessionLoad(last)
        setTranscripts(cues.map((c) => ({ text: c.text, elapsedMs: 0, speaker: c.speaker })))
        seedBuffer(cues.map((c) => c.text))
      })
    })

    // Cmd+, opens Settings (standard macOS convention)
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
      }
      // Cmd+Shift+T toggles transcription
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        toggleRecordingRef.current()
      }
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      unsubTranscript()
      unsubSttStatus()
      unsubIndex()
      unsubInterim()
      unsubModelSwitch()
      unsubParagraphBreak()
      unsubFolder()
      unsubSessions()
      window.removeEventListener('keydown', handleKeyDown)
      if (recommendDebounceRef.current) clearTimeout(recommendDebounceRef.current)
      if (dmDebounceRef.current) clearTimeout(dmDebounceRef.current)
      if (interimDebounceRef.current) clearTimeout(interimDebounceRef.current)
    }
  }, [runRecommendation, runSfxRecommendation, stop, seedBuffer])

  function commitDmPrompt() {
    const text = dmPromptRef.current.trim()
    if (!text) return
    console.log('[recommend] commit DM prompt:', JSON.stringify(text))
    setDmBusy(true)
    runDmRecommendation(text)
    // One text, three panes (ADR-0005): the lights read all of it, the models
    // read the first hintChars of it.
    window.doty.lightsSetHint(activeSession, text).catch(() => {})
  }

  function handleDmChange(text: string) {
    setDmPrompt(text)
    dmPromptRef.current = text
    console.log(
      '[recommend] handleDmChange:',
      JSON.stringify(text),
      'clearing previous debounce:',
      !!dmDebounceRef.current,
    )
    if (dmDebounceRef.current) clearTimeout(dmDebounceRef.current)
    if (text.trim()) {
      console.log(`[recommend] scheduling DM recommendation in ${DM_IDLE_MS}ms`)
      setDmBusy(true)
      dmDebounceRef.current = setTimeout(commitDmPrompt, DM_IDLE_MS)
    } else {
      // Clearing the prompt hands the shelf back to the transcript and drops any
      // decision still in flight for the old text.
      lastDmApplied.current = ++dmSeq.current
      displayedTopRef.current = null
      setDmBusy(false)
      dmDebounceRef.current = setTimeout(() => {
        runRecommendation()
        runSfxRecommendation()
        window.doty.lightsSetHint(activeSession, '').catch(() => {})
      }, 300)
    }
  }

  function commitDmPromptNow() {
    if (dmDebounceRef.current) clearTimeout(dmDebounceRef.current)
    dmDebounceRef.current = null
    commitDmPrompt()
  }

  async function toggleRecording() {
    if (recording) {
      stop()
      await window.doty.sttStop()
      setRecording(false)
      setSessionStartTime(null)
    } else {
      // Start the mic first: sttStart() opens the WAV file and pauses embeddings,
      // so a mic failure must not leave main in a streaming state.
      try {
        const started = await start()
        if (!started) return
        const res = await window.doty.sttStart()
        if (!res.ok) {
          stop()
          setSettingsSection('transcription')
          setShowSettings(true)
          return
        }
      } catch (e) {
        console.error('[main] failed to start recording:', e)
        stop()
        await window.doty.sttStop()
        return
      }
      setRecording(true)
      setSessionStartTime(Date.now())
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden relative" style={{ background: '#080705' }}>
      {/* Ambient background texture */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
          radial-gradient(ellipse at 20% 50%, rgba(200,146,42,0.04) 0%, transparent 60%),
          radial-gradient(ellipse at 80% 20%, rgba(74,138,106,0.03) 0%, transparent 50%)
        `,
        }}
      />

      {/* Title bar drag region */}
      <div className="fixed top-0 left-0 right-0 h-8 z-50" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Header — compact, with transcription toggle merged into status */}
      <header className="flex items-center justify-between px-6 pt-9 pb-2 shrink-0 relative">
        {/* Left: status toggle + transcript visibility */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleRecording}
            aria-pressed={recording}
            className="flex items-center gap-2 px-2.5 py-1.5 transition-all hover:opacity-90"
            style={{
              border: `1px solid ${recording ? 'rgba(239,68,68,0.3)' : sttReady === false ? 'rgba(200,146,42,0.3)' : 'rgba(74,138,106,0.3)'}`,
              background: recording ? 'rgba(239,68,68,0.06)' : 'transparent',
            }}
            title={
              sttReady === false
                ? 'No speech model installed — open Settings to download one'
                : recording
                  ? 'Stop transcription'
                  : 'Start transcription'
            }
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: recording ? '#ef4444' : sttReady === false ? '#d9a441' : '#6dbf95',
                boxShadow: recording
                  ? '0 0 6px rgba(239,68,68,0.8)'
                  : sttReady === false
                    ? '0 0 6px rgba(200,146,42,0.8)'
                    : '0 0 6px rgba(74,138,106,0.8)',
              }}
            />
            <span
              className="text-xs tracking-widest uppercase font-mono"
              style={{
                color:
                  asrStatus === 'crashed'
                    ? '#f59e0b'
                    : sttReady === false
                      ? '#d9a441'
                      : recording
                        ? asrStatus === 'loading'
                          ? '#d9a441'
                          : '#ef4444'
                        : '#6dbf95',
                fontSize: '11px',
              }}
            >
              {asrStatus === 'crashed'
                ? 'Crashed — click to restart'
                : sttReady === false
                  ? 'No model'
                  : recording
                    ? asrStatus === 'loading'
                      ? 'Awakening...'
                      : 'Inscribing'
                    : 'Standby'}
            </span>
          </button>
          {(sttDownload || sttDownloadError) && (
            <button
              type="button"
              onClick={() => {
                setSettingsSection('transcription')
                setShowSettings(true)
              }}
              className="flex items-center gap-2 px-2 py-1 transition-all hover:opacity-80"
              style={{ border: '1px solid rgba(200,146,42,0.3)' }}
              title={
                sttDownloadError
                  ? `Model download failed: ${sttDownloadError}. Open Settings to retry.`
                  : 'Downloading speech model — the rest of Doty stays usable'
              }
            >
              <span style={{ color: '#d9a441', fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace" }}>
                {sttDownloadError ? 'Model failed — retry in Settings' : `Model ${sttDownload?.percent ?? 0}%`}
              </span>
            </button>
          )}
          {showRankerMissing && (
            <span
              className="px-2 py-1"
              style={{
                border: '1px solid rgba(200,146,42,0.3)',
                color: '#d9a441',
                fontSize: '11px',
                fontFamily: "'IBM Plex Mono', monospace",
              }}
              title={
                rankerDownloading
                  ? 'The decision model is downloading. Recommendations use keywords until it lands.'
                  : modelStatus === 'error'
                    ? 'The decision model failed to load. Recommendations use keywords until it is installed in Settings.'
                    : 'The decision model is not installed. Recommendations use heuristics until it is.'
              }
            >
              {rankerDownloading
                ? 'Ranker downloading · keywords'
                : modelStatus === 'error'
                  ? 'Ranker unavailable · keywords'
                  : 'Ranker warming up'}
            </span>
          )}
          {/* The master switch. Off until the DM asks for it: suggestions are
              always offered, but nothing changes on its own. */}
          <button
            type="button"
            data-testid="autopilot-toggle"
            aria-pressed={autopilotEnabled}
            onClick={() => {
              const next = !autopilotEnabled
              setAutopilotEnabled(next)
              window.doty.setAutopilotConfig({ enabled: next }).catch(() => {})
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 transition-all hover:opacity-90"
            style={{
              border: `1px solid ${autopilotEnabled ? 'rgba(217,164,65,0.5)' : '#7a6138'}`,
              color: autopilotEnabled ? '#d9a441' : '#9d8b66',
              fontSize: '11px',
              fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: '0.1em',
            }}
            title={
              autopilotEnabled
                ? 'Autopilot is on: music and SFX change on their own at a track boundary when the pick is clear'
                : 'Autopilot is off: Doty suggests, but what plays stays in your hands'
            }
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: autopilotEnabled ? '#d9a441' : '#9d8b66',
                boxShadow: autopilotEnabled ? '0 0 6px rgba(200,146,42,0.8)' : 'none',
              }}
            />
            AUTOPILOT {autopilotEnabled ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="p-1.5 opacity-70 hover:opacity-100 transition-opacity"
            title={showTranscript ? 'Hide transcript' : 'Show transcript'}
            aria-label={showTranscript ? 'Hide transcript' : 'Show transcript'}
            style={{ color: '#a5813f' }}
          >
            {showTranscript ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>

        {/* Title — the narrow header has no room for it between the controls */}
        <h1
          className={`${showRankerMissing || sttDownload || sttDownloadError ? 'hidden xl:block' : 'hidden lg:block'} text-base tracking-[0.3em] uppercase absolute left-1/2 -translate-x-1/2`}
          style={{ fontFamily: "'Cinzel', serif", color: '#d9a441', textShadow: '0 0 20px rgba(200,146,42,0.5)' }}
        >
          Doty
        </h1>

        {/* Settings button */}
        <button
          type="button"
          onClick={() => {
            setSettingsSection('library')
            setShowSettings(true)
          }}
          className="relative p-2 transition-all group"
          aria-label="Open settings"
          style={{ color: '#a5813f' }}
        >
          <GearIcon
            className="w-4 h-4 transition-all group-hover:rotate-45 group-hover:text-accent"
            style={{ color: 'inherit', transition: 'transform 0.4s ease, color 0.2s' }}
          />
        </button>
      </header>

      {/* Main content */}
      <div className="flex flex-1 gap-4 px-6 pb-6 overflow-hidden">
        {/* Left: Transcript (hidden entirely when collapsed) */}
        {showTranscript && (
          <div className="flex flex-col shrink-0 gap-2 w-[22rem]">
            <Transcript
              segments={transcripts}
              recording={recording}
              asrStatus={asrStatus}
              interimText={interimText}
              micPermission={micPermission}
              sessions={sessions}
              activeSession={activeSession}
              sessionStartTime={sessionStartTime}
              onNewSession={async (name: string) => {
                const s = await window.doty.sessionCreate(name)
                setSessions((prev) => [s, ...prev])
                setActiveSession(s.file)
                setTranscripts([])
                seedBuffer([])
                // Main restarts its own clock for the new file; the header must
                // restart with it, or the take keeps counting from the old one.
                if (recording) setSessionStartTime(Date.now())
              }}
              onSwitchSession={async (file) => {
                setActiveSession(file)
                const cues = await window.doty.sessionLoad(file)
                setTranscripts(cues.map((c) => ({ text: c.text, elapsedMs: 0, speaker: c.speaker })))
                seedBuffer(cues.map((c) => c.text))
              }}
              onRenameSession={async (file, name) => {
                await window.doty.sessionRename(file, name)
                setSessions((prev) => prev.map((s) => (s.file === file ? { ...s, name } : s)))
              }}
              onDeleteSession={async (file) => {
                await window.doty.sessionDelete(file)
                setSessions((prev) => prev.filter((s) => s.file !== file))
                if (activeSession === file) {
                  const remaining = sessions.filter((s) => s.file !== file)
                  if (remaining.length > 0) {
                    setActiveSession(remaining[0].file)
                    const cues = await window.doty.sessionLoad(remaining[0].file)
                    setTranscripts(cues.map((c) => ({ text: c.text, elapsedMs: 0, speaker: c.speaker })))
                    seedBuffer(cues.map((c) => c.text))
                  } else {
                    // Keep a recording destination: deleting the last session
                    // must not leave the mic writing into a void.
                    const s = await window.doty.sessionCreate()
                    setSessions([s])
                    setActiveSession(s.file)
                    setTranscripts([])
                    seedBuffer([])
                  }
                }
              }}
              onCopyTranscript={() => {
                const multi = transcripts.some((s) => s.speaker)
                const text = transcripts
                  .filter((s) => !s.system && s.text)
                  .map((s) => {
                    const prefix = speakerPrefix(s.speaker, multi)
                    return prefix ? `${prefix}: ${s.text}` : s.text
                  })
                  .join(' ')
                navigator.clipboard.writeText(text)
              }}
              onExportTranscript={() => {
                const lines: string[] = []
                const multiSpeaker = transcripts.some((s) => s.speaker)
                for (const seg of transcripts) {
                  if (seg.system) {
                    lines.push(`\n---\n*${seg.text}*\n`)
                    continue
                  }
                  if (!seg.text) continue
                  const ts =
                    seg.elapsedMs > 0
                      ? `[${Math.floor(seg.elapsedMs / 60000)}:${String(Math.floor((seg.elapsedMs / 1000) % 60)).padStart(2, '0')}] `
                      : ''
                  const prefix = speakerPrefix(seg.speaker, multiSpeaker)
                  lines.push(`${ts}${prefix ? `**${prefix}:** ` : ''}${seg.text}`)
                }
                const md = `# Session Transcript\n\n${lines.join('\n\n')}\n`
                navigator.clipboard.writeText(md)
              }}
              availableModels={sttModelList}
            />
          </div>
        )}

        {/* Right: DM prompt + Soundboard */}
        <div className="flex-1 flex flex-col overflow-hidden gap-3">
          {/* DM chat input — top of the view for quick access */}
          <div className="shrink-0 flex items-center gap-2">
            <input
              type="text"
              data-testid="dm-input"
              value={dmPrompt}
              onChange={(e) => handleDmChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitDmPromptNow()
                }
              }}
              placeholder="Describe the mood or scene…"
              aria-label="Describe the mood or scene"
              className="flex-1 bg-transparent outline-none w-full"
              style={{
                fontFamily: "'Crimson Text', serif",
                fontSize: '16px',
                color: '#e4d6b4',
                background: '#100e0a',
                border: '1px solid #3d2f1c',
                borderRadius: '3px',
                padding: '10px 14px',
              }}
            />
            {dmBusy && (
              <span
                data-testid="dm-busy"
                aria-live="polite"
                className="shrink-0 whitespace-nowrap"
                style={{
                  fontSize: '11px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: '#a5813f',
                }}
              >
                reading the room…
              </span>
            )}
          </div>

          <LightPanel session={activeSession} />

          <div className="flex-1 overflow-hidden">
            <Soundboard
              rankerStatus={modelStatus}
              recommendations={recommendations}
              sfxRecommendations={sfxRecommendations}
              sfxCandidates={sfxCandidates}
              sfxProbabilities={sfxProbabilities}
              sfxAutopilot={sfxAutopilot}
              lastConfidence={lastConfidence}
              probabilities={probabilities}
              candidates={candidates}
              sessionText={sessionText}
              indexStatus={indexStatus}
              lastRanker={appliedRanker}
              lastTranscriptSnippet={lastTranscriptSnippet}
              musicFolder={musicFolder}
              speakerDeviceId={speakerDeviceId}
              settingsOpen={showSettings}
              sessionStartTime={sessionStartTime}
              rankerDownloading={rankerDownloading}
              autopilotEnabled={autopilotEnabled}
              onNoFolder={() => setShowSettings(true)}
            />
          </div>
        </div>
      </div>

      <UpdateBar />

      {/* Settings modal */}
      {showSettings && (
        <Settings
          initialSection={settingsSection}
          onClose={() => setShowSettings(false)}
          onFolderChange={setMusicFolder}
          onMicChange={(id) => {
            if (id) localStorage.setItem(MIC_STORAGE_KEY, id)
            else localStorage.removeItem(MIC_STORAGE_KEY)
            setMicDeviceId(id ?? undefined)
          }}
          onSpeakerChange={(id) => {
            if (id) localStorage.setItem(SPEAKER_STORAGE_KEY, id)
            else localStorage.removeItem(SPEAKER_STORAGE_KEY)
            setSpeakerDeviceId(id ?? undefined)
          }}
          micDeviceId={micDeviceId}
          speakerDeviceId={speakerDeviceId}
          rankerStatus={modelStatus}
          recommendCount={recommendCount}
          onRecommendCountChange={(count) => {
            setRecommendCount(count)
            window.doty.setRecommendationCount(count)
          }}
          context={context}
          onContextChange={applyContext}
        />
      )}
    </div>
  )
}
