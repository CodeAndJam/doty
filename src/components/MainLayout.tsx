import { useCallback, useEffect, useRef, useState } from 'react'
import { useQwen } from '../hooks/useQwen'
import { useRecorder } from '../hooks/useRecorder'
import { heuristicSfxRecommend } from '../lib/heuristicSfxRecommend'
import { EyeIcon, EyeOffIcon, GearIcon } from './Icons'
import Settings from './Settings'
import Soundboard from './Soundboard'
import Transcript from './Transcript'

const MIC_STORAGE_KEY = 'doty:micDeviceId'
const SPEAKER_STORAGE_KEY = 'doty:speakerDeviceId'

export default function MainLayout() {
  const [recording, setRecording] = useState(false)
  const [asrStatus, setAsrStatus] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [transcripts, setTranscripts] = useState<string[]>([])
  const [interimText, setInterimText] = useState('')
  const [recommendations, setRecommendations] = useState<string[]>([])
  const [lastConfidence, setLastConfidence] = useState(0)
  const [lastTranscriptSnippet, setLastTranscriptSnippet] = useState('')
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
  const [rerankerCached, setRerankerCached] = useState<boolean | null>(null)
  const [recommendCount, setRecommendCount] = useState(5)
  const [showTranscript, setShowTranscript] = useState(true)
  const transcriptBufferRef = useRef('')
  const [sessions, setSessions] = useState<Array<{ file: string; name: string; created: string }>>([])
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null)
  const recommendDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dmDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recommendCountRef = useRef(recommendCount)
  const [sfxRecommendCount, setSfxRecommendCount] = useState(5)
  const sfxRecommendCountRef = useRef(sfxRecommendCount)
  const { start, stop, micPermission } = useRecorder(micDeviceId)
  const { recommend, modelStatus, downloadProgress, lastRanker } = useQwen()
  const recommendRef = useRef(recommend)

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
        setTranscripts(cues.map((c) => c.text))
      } else if (list.length === 0) {
        // Auto-create first session
        const s = await window.doty.sessionCreate()
        setSessions([s])
        setActiveSession(s.file)
      } else {
        setActiveSession(list[0].file)
        const cues = await window.doty.sessionLoad(list[0].file)
        setTranscripts(cues.map((c) => c.text))
      }
    }
    loadSessions()
  }, [])

  // Check if reranker model is already cached on mount
  useEffect(() => {
    window.doty.rerankerStatus().then(({ cached }) => setRerankerCached(cached))
  }, [])

  // Once model is ready, mark as cached so the banner doesn't reappear
  useEffect(() => {
    if (modelStatus === 'ready') setRerankerCached(true)
  }, [modelStatus])

  const showRerankerDownload = rerankerCached === false && modelStatus === 'loading'

  const runRecommendation = useCallback(async () => {
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
  }, [])

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

    const unsubTranscript = window.doty.onTranscript((text) => {
      setTranscripts((prev) => [...prev, text])
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
      setAsrStatus(status === 'loading' ? 'loading' : status === 'ready' ? 'ready' : 'idle')
    })

    const unsubInterim = window.doty.onSttInterim((text) => {
      setInterimText(text)
    })

    // Listen for SFX recommendations from the backend (fallback)
    const unsubSfxRec = window.doty.onSfxRecommendations((ids) => {
      setSfxRecommendations(ids)
    })

    // Cmd+, opens Settings (standard macOS convention)
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      unsubTranscript()
      unsubSttStatus()
      unsubInterim()
      unsubSfxRec()
      window.removeEventListener('keydown', handleKeyDown)
      if (recommendDebounceRef.current) clearTimeout(recommendDebounceRef.current)
      if (dmDebounceRef.current) clearTimeout(dmDebounceRef.current)
    }
  }, [runRecommendation, runSfxRecommendation])

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
      await window.doty.sttStart()
      await start()
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
              border: `1px solid ${recording ? 'rgba(239,68,68,0.3)' : 'rgba(74,138,106,0.3)'}`,
              background: recording ? 'rgba(239,68,68,0.06)' : 'transparent',
            }}
            title={recording ? 'Stop transcription' : 'Start transcription'}
          >
            <div
              className={`w-1.5 h-1.5 rounded-full ${recording ? 'bg-red-500 animate-pulse' : 'bg-rune'}`}
              style={{ boxShadow: recording ? '0 0 6px rgba(239,68,68,0.8)' : '0 0 6px rgba(74,138,106,0.8)' }}
            />
            <span
              className="text-xs tracking-widest uppercase font-mono"
              style={{
                color: recording ? (asrStatus === 'loading' ? '#c8922a' : '#ef4444') : '#4a8a6a',
                fontSize: '11px',
              }}
            >
              {recording ? (asrStatus === 'loading' ? 'Awakening...' : 'Inscribing') : 'Standby'}
            </span>
          </button>
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
              lines={transcripts}
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
                setTranscripts(cues.map((c) => c.text))
              }}
              onRenameSession={async (file, name) => {
                await window.doty.sessionRename(file, name)
                setSessions((prev) => prev.map((s) => (s.file === file ? { ...s, name } : s)))
              }}
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
              recommendations={recommendations}
              sfxRecommendations={sfxRecommendations}
              lastConfidence={lastConfidence}
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
          qwenStatus={modelStatus}
          recommendCount={recommendCount}
          onRecommendCountChange={(count) => {
            setRecommendCount(count)
            window.doty.setRecommendationCount(count)
          }}
        />
      )}

      {/* Reranker model download overlay */}
      {showRerankerDownload && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="max-w-md w-full mx-8"
            style={{
              background: 'linear-gradient(160deg, #0f0d09, #080705)',
              border: '1px solid #2e2416',
              boxShadow: '0 0 40px rgba(0,0,0,0.8), 0 0 80px rgba(200,146,42,0.05)',
              padding: '28px',
            }}
          >
            {/* Corner ornaments */}
            <div
              className="absolute top-0 left-0 w-4 h-4"
              style={{ borderTop: '1px solid rgba(200,146,42,0.5)', borderLeft: '1px solid rgba(200,146,42,0.5)' }}
            />
            <div
              className="absolute top-0 right-0 w-4 h-4"
              style={{ borderTop: '1px solid rgba(200,146,42,0.5)', borderRight: '1px solid rgba(200,146,42,0.5)' }}
            />
            <div
              className="absolute bottom-0 left-0 w-4 h-4"
              style={{ borderBottom: '1px solid rgba(200,146,42,0.5)', borderLeft: '1px solid rgba(200,146,42,0.5)' }}
            />
            <div
              className="absolute bottom-0 right-0 w-4 h-4"
              style={{ borderBottom: '1px solid rgba(200,146,42,0.5)', borderRight: '1px solid rgba(200,146,42,0.5)' }}
            />

            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 flex items-center justify-center"
                style={{
                  background: 'rgba(200,146,42,0.1)',
                  border: '1px solid rgba(200,146,42,0.2)',
                }}
              >
                <svg
                  className="w-5 h-5"
                  style={{ color: '#c8922a' }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div>
                <h2
                  style={{ fontFamily: "'Cinzel', serif", fontSize: '15px', letterSpacing: '0.15em', color: '#c8922a' }}
                >
                  Summoning Reranker
                </h2>
                <p
                  style={{ fontSize: '13px', color: '#3a2e1a', fontFamily: "'Crimson Text', serif", marginTop: '2px' }}
                >
                  MiniLM-L-6-v2 Reranker (~80 MB) — first time only
                </p>
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ width: '100%', height: '2px', background: '#2e2416', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${downloadProgress?.progress ?? 0}%`,
                    background: '#c8922a',
                    boxShadow: '0 0 6px rgba(200,146,42,0.6)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
              <div
                className="flex justify-between mt-1.5"
                style={{ fontSize: '12px', color: '#3a2e1a', fontFamily: 'monospace' }}
              >
                <span className="truncate max-w-[70%]">{downloadProgress?.file ?? 'Preparing...'}</span>
                <span>{downloadProgress?.progress ? `${downloadProgress.progress.toFixed(0)}%` : ''}</span>
              </div>
            </div>

            <p style={{ fontSize: '12px', color: '#3a2e1a', fontFamily: "'Crimson Text', serif" }}>
              This model enables intelligent music recommendations. It downloads once and runs entirely on your machine.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
