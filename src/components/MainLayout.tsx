import { useState, useEffect, useRef } from 'react'
import Transcript from './Transcript'
import Soundboard from './Soundboard'
import Settings from './Settings'
import { useRecorder } from '../hooks/useRecorder'
import { useQwen } from '../hooks/useQwen'

const MIC_STORAGE_KEY = 'doty:micDeviceId'

function GearIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 15.5A3.5 3.5 0 018.5 12 3.5 3.5 0 0112 8.5a3.5 3.5 0 013.5 3.5 3.5 3.5 0 01-3.5 3.5m7.43-2.92c.04-.34.07-.68.07-1.08s-.03-.74-.07-1.08l2.32-1.82c.21-.16.27-.46.13-.7l-2.2-3.82c-.13-.24-.42-.32-.66-.24l-2.74 1.1c-.57-.44-1.18-.8-1.86-1.08L14.5 2.42c-.04-.26-.27-.42-.5-.42h-4c-.23 0-.46.16-.5.42L9.13 5.36C8.45 5.64 7.84 6 7.27 6.44L4.53 5.34c-.24-.08-.53 0-.66.24L1.67 9.4c-.14.24-.08.54.13.7l2.32 1.82c-.04.34-.07.69-.07 1.08s.03.74.07 1.08L1.8 15.9c-.21.16-.27.46-.13.7l2.2 3.82c.13.24.42.32.66.24l2.74-1.1c.57.44 1.18.8 1.86 1.08l.37 2.94c.04.26.27.42.5.42h4c.23 0 .46-.16.5-.42l.37-2.94c.68-.28 1.29-.64 1.86-1.08l2.74 1.1c.24.08.53 0 .66-.24l2.2-3.82c.14-.24.08-.54-.13-.7l-2.32-1.82z" />
    </svg>
  )
}

export default function MainLayout() {
  const [recording, setRecording] = useState(false)
  const [transcripts, setTranscripts] = useState<string[]>([])
  const [recommendations, setRecommendations] = useState<string[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [musicFolder, setMusicFolder] = useState('')
  const [micDeviceId, setMicDeviceId] = useState<string | undefined>(
    () => localStorage.getItem(MIC_STORAGE_KEY) ?? undefined
  )
  const [dmPrompt, setDmPrompt] = useState('')
  const [dmPending, setDmPending] = useState(false)
  const transcriptBufferRef = useRef('')
  const recommendDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { start, stop } = useRecorder(micDeviceId)
  const { recommend, modelStatus } = useQwen()

  async function runRecommendation() {
    const files = await window.doty.listMusic()
    if (files.length === 0) return
    const results = await recommend(transcriptBufferRef.current, files)
    setRecommendations(results)
  }

  useEffect(() => {
    window.doty.getMusicFolder().then(setMusicFolder)

    const unsubTranscript = window.doty.onTranscript((text) => {
      setTranscripts((prev) => [...prev, text])
      transcriptBufferRef.current = (transcriptBufferRef.current + ' ' + text).slice(-2000)
      // Debounce STT-triggered recommendations — run via Web Worker, not main process
      if (recommendDebounceRef.current) clearTimeout(recommendDebounceRef.current)
      recommendDebounceRef.current = setTimeout(runRecommendation, 1500)
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
      window.removeEventListener('keydown', handleKeyDown)
      if (recommendDebounceRef.current) clearTimeout(recommendDebounceRef.current)
    }
  }, [])

  async function submitDmPrompt() {
    const text = dmPrompt.trim()
    if (!text || dmPending) return
    setDmPending(true)
    try {
      const files = await window.doty.listMusic()
      const combined = [transcriptBufferRef.current, text].filter(Boolean).join('\n\nDM note: ')
      const results = await recommend(combined, files)
      setRecommendations(results)
    } finally {
      setDmPending(false)
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
          {modelStatus === 'loading' && (
            <span className="flex items-center gap-1 ml-2" style={{ color: '#6b4e15', fontSize: '11px', letterSpacing: '0.08em' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#6b4e15' }} />
              loading model…
            </span>
          )}
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
        <div className="flex flex-col w-72 shrink-0 gap-3">
          <Transcript lines={transcripts} recording={recording} />
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
              musicFolder={musicFolder}
              onNoFolder={() => setShowSettings(true)}
            />
          </div>

          {/* DM chat input */}
          <div className="shrink-0 flex gap-2" style={{ borderTop: '1px solid #2e2416', paddingTop: '12px' }}>
            <input
              type="text"
              data-testid="dm-input"
              value={dmPrompt}
              onChange={(e) => setDmPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitDmPrompt() }}
              placeholder="Describe the mood or scene…"
              disabled={dmPending}
              className="flex-1 bg-transparent outline-none text-sm"
              style={{
                fontFamily: "'Crimson Text', serif",
                fontSize: '15px',
                color: '#c8922a',
                border: '1px solid #2e2416',
                padding: '8px 12px',
                opacity: dmPending ? 0.5 : 1,
              }}
            />
            <button
              onClick={submitDmPrompt}
              disabled={dmPending || !dmPrompt.trim()}
              style={{
                fontFamily: "'Cinzel', serif",
                fontSize: '13px',
                letterSpacing: '0.1em',
                color: dmPending || !dmPrompt.trim() ? '#3a2e1a' : '#c8922a',
                border: '1px solid #2e2416',
                padding: '8px 14px',
                background: 'transparent',
                cursor: dmPending || !dmPrompt.trim() ? 'default' : 'pointer',
                transition: 'color 0.2s',
              }}
            >
              {dmPending ? '…' : 'Attune'}
            </button>
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
          micDeviceId={micDeviceId}
        />
      )}
    </div>
  )
}
