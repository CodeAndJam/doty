import { useCallback, useEffect, useRef, useState } from 'react'
import { useRanker } from '../hooks/useRanker'
import { useRecorder } from '../hooks/useRecorder'
import { heuristicSfxRecommend } from '../lib/heuristicSfxRecommend'
import { EyeIcon, EyeOffIcon, GearIcon } from './Icons'
import Settings from './Settings'
import Soundboard from './Soundboard'
import type { TranscriptSegment } from './Transcript'
import Transcript from './Transcript'

const MIC_STORAGE_KEY = 'doty:micDeviceId'
const SPEAKER_STORAGE_KEY = 'doty:speakerDeviceId'

export default function MainLayout() {
  const [recording, setRecording] = useState(false)
  const [asrStatus, setAsrStatus] = useState<'idle' | 'loading' | 'ready' | 'crashed'>('idle')
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([])
  const [interimText, setInterimText] = useState('')
  const [recommendations, setRecommendations] = useState<string[]>([])
  const [lastConfidence, setLastConfidence] = useState(0)
  const [lastTranscriptSnippet, setLastTranscriptSnippet] = useState('')
  /** The transcript window the director reads: wider than the UI snippet. */
  const [sessionText, setSessionText] = useState('')
  const [sfxRecommendations, setSfxRecommendations] = useState<string[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [musicFolder, setMusicFolder] = useState('')
  const [micDeviceId, setMicDeviceId] = useState<string | undefined>(
    () => localStorage.getItem(MIC_STORAGE_KEY) ?? undefined,
  )
  const [speakerDeviceId, setSpeakerDeviceId] = useState<string | undefined>(
    () => localStorage.getItem(SPEAKER_STORAGE_KEY) ?? undefined,
  )
  const [dmPrompt, setDmPrompt] = useState('')
  const [rankerCached, setRankerCached] = useState<boolean | null>(null)
  const [override, setOverride] = useState(false)
  const [recommendCount, setRecommendCount] = useState(5)
  const [showTranscript, setShowTranscript] = useState(true)
  const transcriptBufferRef = useRef('')
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
  const dmDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const interimDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recommendCountRef = useRef(recommendCount)
  const [sfxRecommendCount, setSfxRecommendCount] = useState(5)
  const sfxRecommendCountRef = useRef(sfxRecommendCount)
  const { start, stop, micPermission } = useRecorder(micDeviceId)
  const { recommend, modelStatus, lastRanker } = useRanker()
  const recommendRef = useRef(recommend)
  // Stable handle for the IPC effect below (a plain function is rebuilt every render)
  const toggleRecordingRef = useRef<() => void>(() => {})
  toggleRecordingRef.current = toggleRecording

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

  // Load recommendation count from settings on mount
  useEffect(() => {
    window.doty.getRecommendationCount().then(setRecommendCount)
    window.doty.getSfxRecommendationCount().then(setSfxRecommendCount)
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
        setTranscripts(cues.map((c) => ({ text: c.text, elapsedMs: 0 })))
      } else if (list.length === 0) {
        // Auto-create first session
        const s = await window.doty.sessionCreate()
        setSessions([s])
        setActiveSession(s.file)
      } else {
        setActiveSession(list[0].file)
        const cues = await window.doty.sessionLoad(list[0].file)
        setTranscripts(cues.map((c) => ({ text: c.text, elapsedMs: 0 })))
      }
    }
    loadSessions()
  }, [])

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
        setTranscripts(cues.map((c) => ({ text: c.text, elapsedMs: 0 })))
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
  }, [activeSession])

  // Check if the ranker model is already on disk on mount
  useEffect(() => {
    window.doty.rankerStatus().then(({ cached }) => setRankerCached(cached))
    const unsubRankerDownload = window.doty.onRankerDownloadProgress((p) => {
      if (p.status === 'done') setRankerCached(true)
    })
    return unsubRankerDownload
  }, [])

  // Once model is ready, mark as cached so the banner doesn't reappear
  useEffect(() => {
    if (modelStatus === 'ready') setRankerCached(true)
  }, [modelStatus])

  const showRankerMissing = rankerCached === false && modelStatus !== 'ready'

  const runRecommendation = useCallback(async () => {
    // Override: the DM is driving by hand, so the ranker stays idle.
    if (override) return
    const files = await window.doty.listMusic()
    console.log('[recommend] runRecommendation called, files:', files.length)
    if (files.length === 0) {
      console.log('[recommend] no files, skipping')
      return
    }
    const recentTranscript = transcriptBufferRef.current.slice(-500).trim()
    console.log(
      '[recommend] transcript context:',
      recentTranscript.length,
      'chars, preview:',
      recentTranscript.slice(0, 80),
    )
    const result = await recommendRef.current(recentTranscript, files, recommendCountRef.current)
    console.log('[recommend] results:', result.files.length, result.files, 'confidence:', result.confidence)
    setRecommendations(result.files)
    setLastConfidence(result.confidence)
    setLastTranscriptSnippet(recentTranscript.slice(-120))
    setSessionText(recentTranscript)
  }, [override])

  const runSfxRecommendation = useCallback(async (overrideText?: string) => {
    const sfxList = await window.doty.getSfxList()
    console.log('[sfx-recommend] sfxList:', sfxList.length, 'items')
    if (sfxList.length === 0) {
      console.log('[sfx-recommend] no SFX available, skipping')
      return
    }
    const tagsMap = await window.doty.getTagsMap()
    const playFrequencies = await window.doty.getPlayFrequencies('sfx')
    const text = overrideText ?? transcriptBufferRef.current.slice(-500).trim()
    console.log('[sfx-recommend] text:', JSON.stringify(text.slice(0, 80)), 'count:', sfxRecommendCountRef.current)
    const results = heuristicSfxRecommend(text, sfxList, sfxRecommendCountRef.current, tagsMap, playFrequencies)
    console.log('[sfx-recommend] results:', results.length, results)
    setSfxRecommendations(results)
  }, [])

  const runDmRecommendation = useCallback(
    async (prompt: string) => {
      console.log('[recommend] runDmRecommendation called, prompt:', JSON.stringify(prompt))
      const files = await window.doty.listMusic()
      console.log('[recommend] DM: files:', files.length)
      if (files.length === 0) {
        console.log('[recommend] DM: no files, skipping')
        return
      }
      // DM input takes priority — put it first and repeat it for emphasis.
      // Transcript provides secondary context (truncated to recent only).
      const recentTranscript = transcriptBufferRef.current.slice(-300).trim()
      const parts = [prompt, prompt] // repeat DM intent for weight
      if (recentTranscript) parts.push(recentTranscript)
      const combined = parts.join('\n')
      console.log('[recommend] DM: combined query:', combined.length, 'chars, count:', recommendCountRef.current)
      const result = await recommendRef.current(combined, files, recommendCountRef.current)
      console.log('[recommend] DM: results:', result.files.length, result.files, 'confidence:', result.confidence)
      setRecommendations(result.files)
      setLastConfidence(result.confidence)
      setLastTranscriptSnippet(prompt.slice(-120))
      setSessionText(combined)
      // Also trigger SFX recommendations with the same combined text
      runSfxRecommendation(combined)
    },
    [runSfxRecommendation],
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

    const unsubTranscript = window.doty.onTranscript(({ text, elapsedMs }) => {
      setTranscripts((prev) => [...prev, { text, elapsedMs }])
      setInterimText('') // Clear interim when final arrives
      transcriptBufferRef.current = `${transcriptBufferRef.current} ${text}`.slice(-800)
      // Debounce STT-triggered recommendations — run via Web Worker, not main process
      if (recommendDebounceRef.current) clearTimeout(recommendDebounceRef.current)
      recommendDebounceRef.current = setTimeout(runRecommendation, 1500)
      // Run SFX recommendations immediately — heuristic is cheap (~5ms) and
      // autopilot needs low latency for reactive SFX triggers (see #43)
      runSfxRecommendation()
    })

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
        setTranscripts(cues.map((c) => ({ text: c.text, elapsedMs: 0 })))
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
  }, [runRecommendation, runSfxRecommendation, stop])

  function handleDmChange(text: string) {
    setDmPrompt(text)
    console.log(
      '[recommend] handleDmChange:',
      JSON.stringify(text),
      'clearing previous debounce:',
      !!dmDebounceRef.current,
    )
    if (dmDebounceRef.current) clearTimeout(dmDebounceRef.current)
    if (text.trim()) {
      console.log('[recommend] scheduling DM recommendation in 500ms')
      dmDebounceRef.current = setTimeout(() => {
        console.log('[recommend] debounce fired, calling runDmRecommendation')
        runDmRecommendation(text.trim())
      }, 500)
    } else {
      // When prompt is cleared, re-trigger default recommendations (history-based)
      dmDebounceRef.current = setTimeout(() => {
        runRecommendation()
        runSfxRecommendation()
      }, 300)
    }
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
            className="flex items-center gap-2 px-2 py-1 transition-all hover:opacity-80"
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
                background: recording ? '#ef4444' : sttReady === false ? '#c8922a' : '#4a8a6a',
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
                      ? '#c8922a'
                      : recording
                        ? asrStatus === 'loading'
                          ? '#c8922a'
                          : '#ef4444'
                        : '#4a8a6a',
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
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 px-2 py-1 transition-all hover:opacity-80"
              style={{ border: '1px solid rgba(200,146,42,0.3)' }}
              title={
                sttDownloadError
                  ? `Model download failed: ${sttDownloadError}. Open Settings to retry.`
                  : 'Downloading speech model — the rest of Doty stays usable'
              }
            >
              <span style={{ color: '#c8922a', fontSize: '11px', fontFamily: 'monospace' }}>
                {sttDownloadError ? 'Model failed — retry in Settings' : `Model ${sttDownload?.percent ?? 0}%`}
              </span>
            </button>
          )}
          {showRankerMissing && (
            <span
              className="px-2 py-1"
              style={{
                border: '1px solid rgba(200,146,42,0.3)',
                color: '#c8922a',
                fontSize: '11px',
                fontFamily: 'monospace',
              }}
              title="The ranker model is not installed. Recommendations use heuristics until it is."
            >
              Ranker warming up
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="p-1 opacity-40 hover:opacity-100 transition-opacity"
            title={showTranscript ? 'Hide transcript' : 'Show transcript'}
            style={{ color: '#6b4e15' }}
          >
            {showTranscript ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>

        {/* Title */}
        <h1
          className="text-base tracking-[0.3em] uppercase absolute left-1/2 -translate-x-1/2"
          style={{ fontFamily: "'Cinzel', serif", color: '#c8922a', textShadow: '0 0 20px rgba(200,146,42,0.5)' }}
        >
          Doty
        </h1>

        {/* Settings button */}
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="relative p-1.5 transition-all group"
          style={{ color: '#6b4e15' }}
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
          <div className="flex flex-col shrink-0 gap-2 w-72">
            <Transcript
              segments={transcripts}
              recording={recording}
              asrStatus={asrStatus}
              interimText={interimText}
              micPermission={micPermission}
              sessions={sessions}
              activeSession={activeSession}
              sessionStartTime={sessionStartTime}
              onNewSession={async () => {
                const s = await window.doty.sessionCreate()
                setSessions((prev) => [s, ...prev])
                setActiveSession(s.file)
                setTranscripts([])
              }}
              onSwitchSession={async (file) => {
                setActiveSession(file)
                const cues = await window.doty.sessionLoad(file)
                setTranscripts(cues.map((c) => ({ text: c.text, elapsedMs: 0 })))
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
                    setTranscripts(cues.map((c) => ({ text: c.text, elapsedMs: 0 })))
                  } else {
                    // Keep a recording destination: deleting the last session
                    // must not leave the mic writing into a void.
                    const s = await window.doty.sessionCreate()
                    setSessions([s])
                    setActiveSession(s.file)
                    setTranscripts([])
                  }
                }
              }}
              onCopyTranscript={() => {
                const text = transcripts
                  .filter((s) => !s.system && s.text)
                  .map((s) => s.text)
                  .join(' ')
                navigator.clipboard.writeText(text)
              }}
              onExportTranscript={() => {
                const lines: string[] = []
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
                  lines.push(`${ts}${seg.text}`)
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
          <div className="shrink-0">
            <input
              type="text"
              data-testid="dm-input"
              value={dmPrompt}
              onChange={(e) => handleDmChange(e.target.value)}
              placeholder="Describe the mood or scene…"
              className="flex-1 bg-transparent outline-none text-sm w-full"
              style={{
                fontFamily: "'Crimson Text', serif",
                fontSize: '15px',
                color: '#c8922a',
                border: '1px solid #2e2416',
                padding: '8px 12px',
              }}
            />
          </div>

          <div className="flex-1 overflow-hidden">
            <Soundboard
              rankerStatus={modelStatus}
              override={override}
              onManualAction={() => setOverride(true)}
              onResumeAuto={() => {
                setOverride(false)
                runRecommendation()
              }}
              recommendations={recommendations}
              sfxRecommendations={sfxRecommendations}
              lastConfidence={lastConfidence}
              sessionText={sessionText}
              lastRanker={lastRanker}
              lastTranscriptSnippet={lastTranscriptSnippet}
              musicFolder={musicFolder}
              speakerDeviceId={speakerDeviceId}
              settingsOpen={showSettings}
              onNoFolder={() => setShowSettings(true)}
            />
          </div>
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <Settings
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
        />
      )}
    </div>
  )
}
