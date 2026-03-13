import { useState, useEffect, useRef, useCallback } from 'react'
import Transcript from './Transcript'
import Soundboard from './Soundboard'
import Settings from './Settings'
import { GearIcon, EyeIcon, EyeOffIcon } from './Icons'
import { useRecorder } from '../hooks/useRecorder'
import { useQwen } from '../hooks/useQwen'
import { heuristicSfxRecommend } from '../lib/heuristicSfxRecommend'

const MIC_STORAGE_KEY = 'doty:micDeviceId'
const SPEAKER_STORAGE_KEY = 'doty:speakerDeviceId'

export default function MainLayout() {
  const [recording, setRecording] = useState(false)
  const [transcripts, setTranscripts] = useState<string[]>([])
  const [recommendations, setRecommendations] = useState<string[]>([])
  const [sfxRecommendations, setSfxRecommendations] = useState<string[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [musicFolder, setMusicFolder] = useState('')
  const [micDeviceId, setMicDeviceId] = useState<string | undefined>(
    () => localStorage.getItem(MIC_STORAGE_KEY) ?? undefined
  )
  const [speakerDeviceId, setSpeakerDeviceId] = useState<string | undefined>(
    () => localStorage.getItem(SPEAKER_STORAGE_KEY) ?? undefined
  )
  const [dmPrompt, setDmPrompt] = useState('')
  const [rerankerCached, setRerankerCached] = useState<boolean | null>(null)
  const [recommendCount, setRecommendCount] = useState(5)
  const [showTranscript, setShowTranscript] = useState(true)
  const transcriptBufferRef = useRef('')
  const recommendDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sfxDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dmDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recommendCountRef = useRef(recommendCount)
  const [sfxRecommendCount, setSfxRecommendCount] = useState(5)
  const sfxRecommendCountRef = useRef(sfxRecommendCount)
  const { start, stop } = useRecorder(micDeviceId)
  const { recommend, modelStatus, downloadProgress } = useQwen()
  const recommendRef = useRef(recommend)

  // Keep refs in sync with latest values
  useEffect(() => { recommendCountRef.current = recommendCount }, [recommendCount])
  useEffect(() => { recommendRef.current = recommend }, [recommend])
  useEffect(() => { sfxRecommendCountRef.current = sfxRecommendCount }, [sfxRecommendCount])

  // Load recommendation count from settings on mount
  useEffect(() => {
    window.doty.getRecommendationCount().then(setRecommendCount)
    window.doty.getSfxRecommendationCount().then(setSfxRecommendCount)
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

  async function runRecommendation() {
    const files = await window.doty.listMusic()
    if (files.length === 0) return
    // Use only the most recent transcript context for relevance
    const recentTranscript = transcriptBufferRef.current.slice(-500).trim()
    const results = await recommendRef.current(recentTranscript, files, recommendCountRef.current)
    setRecommendations(results)
  }

  const runSfxRecommendation = useCallback(async (overrideText?: string) => {
    const sfxList = await window.doty.getSfxList()
    if (sfxList.length === 0) return
    const tagsMap = await window.doty.getTagsMap()
    const text = overrideText ?? transcriptBufferRef.current.slice(-500).trim()
    if (!text) return
    const results = heuristicSfxRecommend(text, sfxList, sfxRecommendCountRef.current, tagsMap)
    setSfxRecommendations(results)
  }, [])

  async function runDmRecommendation(prompt: string) {
    const files = await window.doty.listMusic()
    if (files.length === 0) return
    // DM input takes priority — put it first and repeat it for emphasis.
    // Transcript provides secondary context (truncated to recent only).
    const recentTranscript = transcriptBufferRef.current.slice(-300).trim()
    const parts = [prompt, prompt]  // repeat DM intent for weight
    if (recentTranscript) parts.push(recentTranscript)
    const combined = parts.join('\n')
    const results = await recommendRef.current(combined, files, recommendCountRef.current)
    setRecommendations(results)
    // Also trigger SFX recommendations with the same combined text
    runSfxRecommendation(combined)
  }

  useEffect(() => {
    window.doty.getMusicFolder().then(setMusicFolder)

    const unsubTranscript = window.doty.onTranscript((text) => {
      setTranscripts((prev) => [...prev, text])
      transcriptBufferRef.current = (transcriptBufferRef.current + ' ' + text).slice(-800)
      // Debounce STT-triggered recommendations — run via Web Worker, not main process
      if (recommendDebounceRef.current) clearTimeout(recommendDebounceRef.current)
      recommendDebounceRef.current = setTimeout(runRecommendation, 1500)
      // Debounce SFX recommendations — heuristic, runs in renderer
      if (sfxDebounceRef.current) clearTimeout(sfxDebounceRef.current)
      sfxDebounceRef.current = setTimeout(runSfxRecommendation, 1500)
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
      unsubSfxRec()
      window.removeEventListener('keydown', handleKeyDown)
      if (recommendDebounceRef.current) clearTimeout(recommendDebounceRef.current)
      if (sfxDebounceRef.current) clearTimeout(sfxDebounceRef.current)
      if (dmDebounceRef.current) clearTimeout(dmDebounceRef.current)
    }
  }, [])

  function handleDmChange(text: string) {
    setDmPrompt(text)
    if (dmDebounceRef.current) clearTimeout(dmDebounceRef.current)
    if (text.trim()) {
      dmDebounceRef.current = setTimeout(() => runDmRecommendation(text.trim()), 500)
    }
  }

  async function toggleRecording() {
    if (recording) {
      stop()
      await window.doty.sttStop()
      setRecording(false)
    } else {
      await window.doty.sttStart()
      await start()
      setRecording(true)
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden relative" style={{ background: '#080705' }}>
      {/* Ambient background texture */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: `
          radial-gradient(ellipse at 20% 50%, rgba(200,146,42,0.04) 0%, transparent 60%),
          radial-gradient(ellipse at 80% 20%, rgba(74,138,106,0.03) 0%, transparent 50%)
        `
      }} />

      {/* Title bar drag region */}
      <div
        className="fixed top-0 left-0 right-0 h-8 z-50"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Header */}
      <header className="flex items-center justify-between px-6 pt-10 pb-4 shrink-0 relative">
        {/* Left status */}
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${recording ? 'bg-red-500 animate-pulse' : 'bg-rune'}`}
            style={{ boxShadow: recording ? '0 0 6px rgba(239,68,68,0.8)' : '0 0 6px rgba(74,138,106,0.8)' }}
          />
          <span className="text-xs tracking-widest uppercase font-mono"
            style={{ color: recording ? '#ef4444' : '#4a8a6a', fontSize: '16px' }}>
            {recording ? 'Transcribing' : 'Standby'}
          </span>
        </div>

        {/* Title */}
        <div className="flex flex-col items-center">
          <h1 className="text-base tracking-[0.3em] uppercase"
            style={{ fontFamily: "'Cinzel', serif", color: '#c8922a', textShadow: '0 0 20px rgba(200,146,42,0.5)' }}>
            Doty
          </h1>
          <div className="flex items-center gap-1 mt-0.5">
            <div className="h-px w-8" style={{ background: 'linear-gradient(to right, transparent, #2e2416)' }} />
            <span style={{ color: '#2e2416', fontSize: '14px' }}>✦</span>
            <div className="h-px w-8" style={{ background: 'linear-gradient(to left, transparent, #2e2416)' }} />
          </div>
        </div>

        {/* Settings button */}
        <button
          onClick={() => setShowSettings(true)}
          className="relative p-1.5 transition-all group"
          style={{ color: '#6b4e15' }}
        >
          <GearIcon className="w-4 h-4 transition-all group-hover:rotate-45 group-hover:text-accent"
            style={{ color: 'inherit', transition: 'transform 0.4s ease, color 0.2s' }} />
        </button>
      </header>

      {/* Divider */}
      <div className="mx-6 mb-4 shrink-0 flex items-center gap-2">
        <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, transparent, #2e2416, transparent)' }} />
        <span style={{ color: '#2e2416', fontSize: '14px' }}>⬡</span>
        <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, transparent, #2e2416, transparent)' }} />
      </div>

      {/* Main content */}
      <div className="flex flex-1 gap-4 px-6 pb-6 overflow-hidden">
        {/* Left: Transcript + Record button */}
        <div className={`flex flex-col shrink-0 gap-3 ${showTranscript ? 'w-72' : 'w-auto'}`}>
          {/* Transcript toggle + panel */}
          {showTranscript ? (
            <>
              <div className="flex items-center justify-between shrink-0">
                <button
                  onClick={() => setShowTranscript(false)}
                  className="p-1 opacity-50 hover:opacity-100 transition-opacity"
                  title="Hide transcript"
                  style={{ color: '#6b4e15' }}
                >
                  <EyeOffIcon />
                </button>
              </div>
              <Transcript lines={transcripts} recording={recording} />
            </>
          ) : (
            <button
              onClick={() => setShowTranscript(true)}
              className="p-2 opacity-50 hover:opacity-100 transition-opacity self-start"
              title="Show transcript"
              style={{ color: '#6b4e15', border: '1px solid #2e2416' }}
            >
              <EyeIcon />
            </button>
          )}
          <button
            onClick={toggleRecording}
            className="relative flex items-center justify-center gap-2.5 py-3 text-sm transition-all overflow-hidden"
            style={{
              background: recording
                ? 'rgba(239,68,68,0.08)'
                : 'linear-gradient(135deg, rgba(200,146,42,0.12), rgba(107,78,21,0.08))',
              border: `1px solid ${recording ? 'rgba(239,68,68,0.4)' : 'rgba(200,146,42,0.3)'}`,
              color: recording ? '#ef4444' : '#c8922a',
              boxShadow: recording
                ? '0 0 12px rgba(239,68,68,0.15), inset 0 1px 0 rgba(255,255,255,0.03)'
                : '0 0 12px rgba(200,146,42,0.15), inset 0 1px 0 rgba(255,255,255,0.03)',
              fontFamily: "'Cinzel', serif",
              letterSpacing: '0.15em',
              fontSize: '14px',
            }}
          >
            {recording ? (
              <>
                <span className="w-2 h-2 bg-red-500 rounded-sm animate-pulse" />
                Cease Transcription
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full" style={{ background: '#c8922a', boxShadow: '0 0 6px rgba(200,146,42,0.8)' }} />
                Begin Transcription
              </>
            )}
          </button>
        </div>

        {/* Right: Soundboard + DM prompt */}
        <div className="flex-1 flex flex-col overflow-hidden gap-3">
          <div className="flex-1 overflow-hidden">
            <Soundboard
              recommendations={recommendations}
              sfxRecommendations={sfxRecommendations}
              musicFolder={musicFolder}
              speakerDeviceId={speakerDeviceId}
              onNoFolder={() => setShowSettings(true)}
            />
          </div>

          {/* DM chat input */}
          <div className="shrink-0" style={{ borderTop: '1px solid #2e2416', paddingTop: '12px' }}>
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
        <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="max-w-md w-full mx-8" style={{
            background: 'linear-gradient(160deg, #0f0d09, #080705)',
            border: '1px solid #2e2416',
            boxShadow: '0 0 40px rgba(0,0,0,0.8), 0 0 80px rgba(200,146,42,0.05)',
            padding: '28px',
          }}>
            {/* Corner ornaments */}
            <div className="absolute top-0 left-0 w-4 h-4" style={{ borderTop: '1px solid rgba(200,146,42,0.5)', borderLeft: '1px solid rgba(200,146,42,0.5)' }} />
            <div className="absolute top-0 right-0 w-4 h-4" style={{ borderTop: '1px solid rgba(200,146,42,0.5)', borderRight: '1px solid rgba(200,146,42,0.5)' }} />
            <div className="absolute bottom-0 left-0 w-4 h-4" style={{ borderBottom: '1px solid rgba(200,146,42,0.5)', borderLeft: '1px solid rgba(200,146,42,0.5)' }} />
            <div className="absolute bottom-0 right-0 w-4 h-4" style={{ borderBottom: '1px solid rgba(200,146,42,0.5)', borderRight: '1px solid rgba(200,146,42,0.5)' }} />

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 flex items-center justify-center" style={{
                background: 'rgba(200,146,42,0.1)',
                border: '1px solid rgba(200,146,42,0.2)',
              }}>
                <svg className="w-5 h-5" style={{ color: '#c8922a' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: '15px', letterSpacing: '0.15em', color: '#c8922a' }}>
                  Summoning Reranker
                </h2>
                <p style={{ fontSize: '13px', color: '#3a2e1a', fontFamily: "'Crimson Text', serif", marginTop: '2px' }}>
                  MiniLM-L-6-v2 Reranker (~80 MB) — first time only
                </p>
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ width: '100%', height: '2px', background: '#2e2416', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${downloadProgress?.progress ?? 0}%`,
                  background: '#c8922a',
                  boxShadow: '0 0 6px rgba(200,146,42,0.6)',
                  transition: 'width 0.3s',
                }} />
              </div>
              <div className="flex justify-between mt-1.5" style={{ fontSize: '12px', color: '#3a2e1a', fontFamily: 'monospace' }}>
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
