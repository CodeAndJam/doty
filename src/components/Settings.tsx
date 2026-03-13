import { useState, useEffect, useRef } from 'react'
import type { ScanProgress } from '../types'
import { onQwenLog } from '../hooks/useQwen'
import { useCrossfade } from '../hooks/useCrossfade'
import DiscordPanel from './DiscordPanel'

interface Props {
  onClose: () => void
  onFolderChange: (folder: string) => void
  onMicChange: (deviceId: string | null) => void
  onSpeakerChange: (deviceId: string | null) => void
  micDeviceId?: string
  speakerDeviceId?: string
  qwenStatus: 'loading' | 'ready' | 'error'
  recommendCount: number
  onRecommendCountChange: (count: number) => void
}

interface AudioDevice {
  deviceId: string
  label: string
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: "'Cinzel', serif",
      fontSize: '15px',
      letterSpacing: '0.25em',
      color: '#6b4e15',
      textTransform: 'uppercase' as const,
      display: 'block',
      marginBottom: '8px',
    }}>
      {children}
    </span>
  )
}

export default function Settings({ onClose, onFolderChange, onMicChange, onSpeakerChange, micDeviceId, speakerDeviceId, qwenStatus, recommendCount, onRecommendCountChange }: Props) {
  const [folder, setFolder] = useState('')
  const [trackCount, setTrackCount] = useState(0)
  const [sttReady, setSttReady] = useState(false)
  const [transcriptFolder, setTranscriptFolder] = useState('')
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
  const [scanDone, setScanDone] = useState(false)
  const [lastScanTime, setLastScanTime] = useState<string | null>(null)
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([])
  const [selectedMic, setSelectedMic] = useState<string>(micDeviceId ?? '')
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>(speakerDeviceId ?? '')
  const [showQwenLogs, setShowQwenLogs] = useState(false)
  const [qwenLogs, setQwenLogs] = useState<string[]>([])
  const [hotwordsFile, setHotwordsFile] = useState('')
  const [sfxFolder, setSfxFolder] = useState('')
  const [sfxRecommendCount, setSfxRecommendCount] = useState(5)
  const logEndRef = useRef<HTMLDivElement>(null)
  const { crossfadeMs, setCrossfadeMs } = useCrossfade()

  // Subscribe to verbose Qwen worker logs
  useEffect(() => {
    const unsub = onQwenLog((msg) => {
      const ts = new Date().toLocaleTimeString()
      setQwenLogs(prev => [...prev.slice(-200), `[${ts}] ${msg}`])
    })
    return () => { unsub() }
  }, [])

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [qwenLogs])

  useEffect(() => {
    window.doty.getMusicFolder().then((f) => {
      setFolder(f)
      if (f) refreshTrackCount()
    })
    window.doty.modelStatus().then(({ ready }) => setSttReady(ready))
    window.doty.getTranscriptFolder().then(setTranscriptFolder)
    window.doty.getHotwordsFile().then(setHotwordsFile)
    window.doty.getSfxFolder().then(setSfxFolder)
    window.doty.getSfxRecommendationCount().then(setSfxRecommendCount)

    const unsubProgress = window.doty.onScanProgress((p) => {
      setScanProgress(p)
      setScanDone(false)
    })
    const unsubComplete = window.doty.onScanComplete(() => {
      setScanProgress(null)
      setScanDone(true)
      setLastScanTime(new Date().toLocaleTimeString())
    })

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then((devices) => {
        const inputs = devices
          .filter((d) => d.kind === 'audioinput')
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
        setAudioDevices(inputs)
        const outputs = devices
          .filter((d) => d.kind === 'audiooutput')
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Speaker ${i + 1}` }))
        setOutputDevices(outputs)
      })
      .catch(() => {})

    return () => { unsubProgress(); unsubComplete() }
  }, [])

  // Escape key to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function refreshTrackCount() {
    const files = await window.doty.listMusic()
    setTrackCount(files.length)
  }

  async function pickFolder() {
    const picked = await window.doty.pickMusicFolder()
    if (picked) {
      setFolder(picked)
      onFolderChange(picked)
      refreshTrackCount()
      setScanDone(false)
      setScanProgress(null)
    }
  }

  async function pickTranscriptFolder() {
    const picked = await window.doty.pickTranscriptFolder()
    if (picked) setTranscriptFolder(picked)
  }

  async function rescan() {
    setScanDone(false)
    setScanProgress(null)
    await window.doty.triggerScan()
  }

  function handleMicChange(deviceId: string) {
    setSelectedMic(deviceId)
    onMicChange(deviceId || null)
  }

  function handleSpeakerChange(deviceId: string) {
    setSelectedSpeaker(deviceId)
    onSpeakerChange(deviceId || null)
  }

  const scanPercent = scanProgress && scanProgress.total > 0
    ? Math.round((scanProgress.done / scanProgress.total) * 100)
    : 0

  const qwenIsReady = qwenStatus === 'ready'
  const qwenIsError = qwenStatus === 'error'

  const qwenDotColor = qwenIsReady ? '#4a8a6a' : qwenIsError ? '#ef4444' : '#c8922a'
  const qwenDotShadow = qwenIsReady
    ? '0 0 6px rgba(74,138,106,0.7)'
    : qwenIsError
      ? '0 0 6px rgba(239,68,68,0.7)'
      : '0 0 6px rgba(200,146,42,0.7)'
  const qwenLabel = qwenIsReady ? 'Attuned' : qwenIsError ? 'Failed — using heuristic fallback' : 'Summoning...'

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: '#080705',
    border: '1px solid #2e2416',
    padding: '8px 12px',
    fontSize: '15px',
    color: '#c8b07a',
    fontFamily: "'Crimson Text', serif",
    outline: 'none',
  }

  const btnStyle: React.CSSProperties = {
    padding: '8px 14px',
    background: 'rgba(200,146,42,0.08)',
    border: '1px solid rgba(200,146,42,0.3)',
    color: '#c8922a',
    fontSize: '16px',
    fontFamily: "'Cinzel', serif",
    letterSpacing: '0.1em',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    transition: 'all 0.2s',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose} style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <div className="relative w-full max-w-md overflow-y-auto" onClick={e => e.stopPropagation()} style={{
        background: 'linear-gradient(160deg, #0f0d09, #080705)',
        border: '1px solid #2e2416',
        boxShadow: '0 0 40px rgba(0,0,0,0.8), 0 0 80px rgba(200,146,42,0.05)',
        maxHeight: '90vh',
        padding: '28px',
      }}>
        {/* Corner ornaments */}
        <div className="absolute top-0 left-0 w-4 h-4" style={{ borderTop: '1px solid rgba(200,146,42,0.5)', borderLeft: '1px solid rgba(200,146,42,0.5)' }} />
        <div className="absolute top-0 right-0 w-4 h-4" style={{ borderTop: '1px solid rgba(200,146,42,0.5)', borderRight: '1px solid rgba(200,146,42,0.5)' }} />
        <div className="absolute bottom-0 left-0 w-4 h-4" style={{ borderBottom: '1px solid rgba(200,146,42,0.5)', borderLeft: '1px solid rgba(200,146,42,0.5)' }} />
        <div className="absolute bottom-0 right-0 w-4 h-4" style={{ borderBottom: '1px solid rgba(200,146,42,0.5)', borderRight: '1px solid rgba(200,146,42,0.5)' }} />

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: '16px', letterSpacing: '0.2em', color: '#c8922a', textShadow: '0 0 12px rgba(200,146,42,0.4)' }}>
            Configuration
          </h2>
          <button onClick={onClose} style={{ color: '#3a2e1a', transition: 'color 0.2s', cursor: 'pointer', background: 'none', border: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#c8922a')}
            onMouseLeave={e => (e.currentTarget.style.color = '#3a2e1a')}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Divider */}
        <div className="mb-5" style={{ height: '1px', background: 'linear-gradient(to right, transparent, #2e2416, transparent)' }} />

        {/* Microphone */}
        <div className="mb-5">
          <Label>Listening Device</Label>
          {audioDevices.length === 0 ? (
            <div style={{ ...inputStyle, color: '#3a2e1a', fontStyle: 'italic' }}>No devices found</div>
          ) : (
            <select value={selectedMic} onChange={(e) => handleMicChange(e.target.value)} style={inputStyle}>
              <option value="">System default</option>
              {audioDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          )}
        </div>

        {/* Speaker */}
        <div className="mb-5">
          <Label>Sound Conduit</Label>
          {outputDevices.length === 0 ? (
            <div style={{ ...inputStyle, color: '#3a2e1a', fontStyle: 'italic' }}>No devices found</div>
          ) : (
            <select value={selectedSpeaker} onChange={(e) => handleSpeakerChange(e.target.value)} style={inputStyle}>
              <option value="">System default</option>
              {outputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          )}
        </div>

        {/* Music folder */}
        <div className="mb-5">
          <Label>Music Archive</Label>
          <div className="flex gap-2">
            <div style={{ ...inputStyle, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {folder || <span style={{ color: '#3a2e1a', fontStyle: 'italic' }}>No archive selected</span>}
            </div>
            <button onClick={pickFolder} style={btnStyle}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(200,146,42,0.15)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}>
              Browse
            </button>
          </div>
          {folder && (
            <p style={{ fontSize: '14px', color: '#3a2e1a', marginTop: '6px', fontFamily: "'Crimson Text', serif" }}>
              {trackCount} scrolls catalogued
            </p>
          )}
        </div>

        {/* Scan status */}
        {folder && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <Label>Arcane Analysis</Label>
              <button onClick={rescan} disabled={!!scanProgress}
                style={{ fontSize: '16px', color: scanProgress ? '#3a2e1a' : '#c8922a', fontFamily: "'Cinzel', serif", letterSpacing: '0.1em', background: 'none', border: 'none', cursor: scanProgress ? 'not-allowed' : 'pointer' }}>
                Re-analyse
              </button>
            </div>
            {scanProgress ? (
              <div>
                <div style={{ width: '100%', height: '2px', background: '#2e2416', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${scanPercent}%`, background: '#c8922a', boxShadow: '0 0 6px rgba(200,146,42,0.6)', transition: 'width 0.2s' }} />
                </div>
                <div className="flex justify-between mt-1.5" style={{ fontSize: '16px', color: '#3a2e1a', fontFamily: 'monospace' }}>
                  <span className="truncate max-w-[70%]">{scanProgress.current}</span>
                  <span>{scanProgress.done} / {scanProgress.total}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2" style={{ fontSize: '14px', color: '#3a2e1a', fontFamily: "'Crimson Text', serif" }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: scanDone ? '#4a8a6a' : '#2e2416', boxShadow: scanDone ? '0 0 6px rgba(74,138,106,0.7)' : 'none' }} />
                {scanDone ? `Analysis complete${lastScanTime ? ` · ${lastScanTime}` : ''}` : 'Awaiting analysis...'}
              </div>
            )}
          </div>
        )}

        {/* Transcript folder */}
        <div className="mb-5">
          <Label>Transcript Vault</Label>
          <div className="flex gap-2">
            <div style={{ ...inputStyle, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {transcriptFolder || <span style={{ color: '#3a2e1a', fontStyle: 'italic' }}>No vault selected</span>}
            </div>
            <button onClick={pickTranscriptFolder} style={btnStyle}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(200,146,42,0.15)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}>
              Browse
            </button>
          </div>
          {transcriptFolder && (
            <p style={{ fontSize: '14px', color: '#3a2e1a', marginTop: '6px', fontFamily: "'Crimson Text', serif" }}>
              Scrolls inscribed automatically
            </p>
          )}
        </div>

        {/* Recommendation count */}
        <div className="mb-5">
          <Label>Arcane Lexicon (Hotwords)</Label>
          <p style={{ fontSize: '14px', color: '#3a2e1a', marginBottom: '8px', fontFamily: "'Crimson Text', serif" }}>
            Add campaign names, spells, and places to improve transcription accuracy
          </p>
          <div className="flex gap-2">
            <div style={{ ...inputStyle, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {hotwordsFile || <span style={{ color: '#3a2e1a', fontStyle: 'italic' }}>No lexicon selected</span>}
            </div>
            <button onClick={async () => {
              const picked = await window.doty.pickHotwordsFile()
              if (picked) setHotwordsFile(picked)
            }} style={btnStyle}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(200,146,42,0.15)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}>
              Browse
            </button>
          </div>
          {!hotwordsFile && (
            <button onClick={async () => {
              const result = await window.doty.createDefaultHotwords()
              if (result.ok && result.path) setHotwordsFile(result.path)
            }} style={{ ...btnStyle, marginTop: '6px', fontSize: '13px', padding: '5px 10px' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(200,146,42,0.15)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}>
              Create default lexicon
            </button>
          )}
          {hotwordsFile && (
            <div className="flex items-center gap-2 mt-1.5">
              <p style={{ fontSize: '14px', color: '#3a2e1a', fontFamily: "'Crimson Text', serif", flex: 1 }}>
                Beam search enabled with lexicon boosting
              </p>
              <button onClick={() => {
                window.doty.setHotwordsFile('')
                setHotwordsFile('')
              }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3a2e1a', fontSize: '12px', fontFamily: 'monospace' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#c8922a')}
                onMouseLeave={e => (e.currentTarget.style.color = '#3a2e1a')}>
                clear
              </button>
            </div>
          )}
        </div>

        {/* Recommendation count */}
        <div className="mb-5">
          <Label>Recommendations</Label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={20}
              value={recommendCount}
              onChange={(e) => onRecommendCountChange(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#c8922a' }}
            />
            <span style={{ fontSize: '15px', color: '#c8b07a', fontFamily: 'monospace', minWidth: '24px', textAlign: 'right' }}>
              {recommendCount}
            </span>
          </div>
          <p style={{ fontSize: '14px', color: '#3a2e1a', marginTop: '4px', fontFamily: "'Crimson Text', serif" }}>
            Number of tracks to suggest per query
          </p>
        </div>

        {/* SFX folder */}
        <div className="mb-5">
          <Label>Sound Effects Archive</Label>
          <div className="flex gap-2">
            <div style={{ ...inputStyle, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sfxFolder || <span style={{ color: '#3a2e1a', fontStyle: 'italic' }}>No SFX archive selected</span>}
            </div>
            <button onClick={async () => {
              const picked = await window.doty.pickSfxFolder()
              if (picked) setSfxFolder(picked)
            }} style={btnStyle}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(200,146,42,0.15)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}>
              Browse
            </button>
          </div>
          {sfxFolder && (
            <p style={{ fontSize: '14px', color: '#3a2e1a', marginTop: '6px', fontFamily: "'Crimson Text', serif" }}>
              Effects loaded from this directory
            </p>
          )}
        </div>

        {/* SFX recommendation count */}
        <div className="mb-5">
          <Label>SFX Suggestions</Label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={10}
              value={sfxRecommendCount}
              onChange={(e) => {
                const v = Number(e.target.value)
                setSfxRecommendCount(v)
                window.doty.setSfxRecommendationCount(v)
              }}
              style={{ flex: 1, accentColor: '#4a8a6a' }}
            />
            <span style={{ fontSize: '15px', color: '#c8b07a', fontFamily: 'monospace', minWidth: '24px', textAlign: 'right' }}>
              {sfxRecommendCount}
            </span>
          </div>
          <p style={{ fontSize: '14px', color: '#3a2e1a', marginTop: '4px', fontFamily: "'Crimson Text', serif" }}>
            Number of effects to suggest per scene
          </p>
        </div>

        {/* Crossfade duration */}
        <div className="mb-5">
          <Label>Crossfade</Label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={5000}
              step={100}
              value={crossfadeMs}
              onChange={(e) => setCrossfadeMs(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#c8922a' }}
            />
            <span style={{ fontSize: '15px', color: '#c8b07a', fontFamily: 'monospace', minWidth: '36px', textAlign: 'right' }}>
              {(crossfadeMs / 1000).toFixed(1)}s
            </span>
          </div>
          <p style={{ fontSize: '14px', color: '#3a2e1a', marginTop: '4px', fontFamily: "'Crimson Text', serif" }}>
            {crossfadeMs === 0 ? 'Instant transition between tracks' : 'Smooth fade between tracks'}
          </p>
        </div>

        {/* Models status */}
        <div className="mb-6">
          <Label>Cognition Engines</Label>

          {/* STT model */}
          <div className="flex items-center gap-3 mb-2" style={{ background: '#080705', border: '1px solid #2e2416', padding: '10px 12px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, background: sttReady ? '#4a8a6a' : '#c8922a', boxShadow: sttReady ? '0 0 6px rgba(74,138,106,0.7)' : '0 0 6px rgba(200,146,42,0.7)' }} />
            <div className="flex-1 min-w-0">
              <p style={{ fontSize: '15px', color: '#c8b07a', fontFamily: "'Crimson Text', serif" }}>Parakeet TDT v3</p>
              <p style={{ fontSize: '13px', color: '#3a2e1a', fontFamily: 'monospace' }}>{sttReady ? 'Attuned' : 'Not yet summoned'}</p>
            </div>
            {!sttReady && <span style={{ fontSize: '13px', color: '#3a2e1a', fontFamily: 'monospace' }}>~640 MB</span>}
          </div>

          {/* MiniLM reranker recommendation model */}
          <div style={{ background: '#080705', border: '1px solid #2e2416', padding: '10px 12px' }}>
            <div className="flex items-center gap-3">
              <div style={{
                width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                background: qwenDotColor,
                boxShadow: qwenDotShadow,
                animation: !qwenIsReady ? 'pulse 1.5s ease-in-out infinite' : 'none',
              }} />
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: '15px', color: '#c8b07a', fontFamily: "'Crimson Text', serif" }}>MiniLM-L-6-v2 Reranker</p>
                <p style={{ fontSize: '13px', color: '#3a2e1a', fontFamily: 'monospace' }}>{qwenLabel}</p>
              </div>
              {!qwenIsReady && (
                <span style={{ fontSize: '13px', color: '#3a2e1a', fontFamily: 'monospace' }}>~80 MB</span>
              )}
              <button
                onClick={() => setShowQwenLogs(prev => !prev)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#3a2e1a', transition: 'color 0.2s', padding: '2px',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#c8922a')}
                onMouseLeave={e => (e.currentTarget.style.color = '#3a2e1a')}
                title={showQwenLogs ? 'Hide logs' : 'Show logs'}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  {showQwenLogs
             ? <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    : <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  }
                </svg>
              </button>
            </div>

            {/* Collapsible log panel */}
            {showQwenLogs && (
              <div style={{
                marginTop: '8px',
                padding: '6px 8px',
                background: '#050403',
                border: '1px solid rgba(46,36,22,0.5)',
                maxHeight: '120px',
                overflowY: 'auto',
                fontSize: '11px',
                fontFamily: 'monospace',
                color: '#5a4a2a',
                lineHeight: '1.6',
              }}>
                {qwenLogs.length === 0 ? (
                  <span style={{ fontStyle: 'italic', color: '#3a2e1a' }}>No events yet...</span>
                ) : (
                  qwenLogs.map((log, i) => (
                    <div key={i} style={{ color: log.includes('ready') || log.includes('Ready') ? '#4a8a6a' : '#5a4a2a' }}>
                      {log}
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Divider before Discord */}
        <div className="mb-5" style={{ height: '1px', background: 'linear-gradient(to right, transparent, #2e2416, transparent)' }} />

        {/* Discord integration */}
        <div className="mb-6">
          <DiscordPanel />
        </div>

        {/* Divider before future features */}
        <div className="mb-5" style={{ height: '1px', background: 'linear-gradient(to right, transparent, #2e2416, transparent)' }} />

        {/* Future features */}
        <div className="mb-2">
          <Label>Coming Soon</Label>

          {/* Autopilot (#12) */}
          <div className="flex items-center gap-3 mb-2" style={{ background: '#080705', border: '1px solid #2e2416', padding: '10px 12px', opacity: 0.5 }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, background: '#2e2416' }} />
            <div className="flex-1 min-w-0">
              <p style={{ fontSize: '15px', color: '#c8b07a', fontFamily: "'Crimson Text', serif" }}>Autopilot Mode</p>
              <p style={{ fontSize: '13px', color: '#3a2e1a', fontFamily: 'monospace' }}>Auto-play music based on scene context</p>
            </div>
          </div>

          {/* Remote Control (#22) */}
          <div className="flex items-center gap-3" style={{ background: '#080705', border: '1px solid #2e2416', padding: '10px 12px', opacity: 0.5 }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, background: '#2e2416' }} />
            <div className="flex-1 min-w-0">
              <p style={{ fontSize: '15px', color: '#c8b07a', fontFamily: "'Crimson Text', serif" }}>Remote Control</p>
              <p style={{ fontSize: '13px', color: '#3a2e1a', fontFamily: 'monospace' }}>HTTP API + Stream Deck support</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
