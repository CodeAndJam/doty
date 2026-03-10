import { useState, useEffect } from 'react'
import type { ScanProgress } from '../types'

interface Props {
  onClose: () => void
  onFolderChange: (folder: string) => void
  onMicChange: (deviceId: string | null) => void
  micDeviceId?: string
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

export default function Settings({ onClose, onFolderChange, onMicChange, micDeviceId }: Props) {
  const [folder, setFolder] = useState('')
  const [trackCount, setTrackCount] = useState(0)
  const [modelReady, setModelReady] = useState(false)
  const [transcriptFolder, setTranscriptFolder] = useState('')
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
  const [scanDone, setScanDone] = useState(false)
  const [lastScanTime, setLastScanTime] = useState<string | null>(null)
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([])
  const [selectedMic, setSelectedMic] = useState<string>(micDeviceId ?? '')

  useEffect(() => {
    window.doty.getMusicFolder().then((f) => {
      setFolder(f)
      if (f) refreshTrackCount()
    })
    window.doty.modelStatus().then(({ ready }) => setModelReady(ready))
    window.doty.getTranscriptFolder().then(setTranscriptFolder)

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
      })
      .catch(() => {})

    return () => { unsubProgress(); unsubComplete() }
  }, [])

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

  const scanPercent = scanProgress && scanProgress.total > 0
    ? Math.round((scanProgress.done / scanProgress.total) * 100)
    : 0

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
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <div className="relative w-full max-w-md overflow-y-auto" style={{
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
                {scanDone ? `Analysis complete${lastScanTime ? ` · ${lastScanTime}` : ''}` : 'Awaiting analysis…'}
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

        {/* Model status */}
        <div className="mb-6">
          <Label>Cognition Engine</Label>
          <div className="flex items-center gap-3" style={{ background: '#080705', border: '1px solid #2e2416', padding: '10px 12px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, background: modelReady ? '#4a8a6a' : '#c8922a', boxShadow: modelReady ? '0 0 6px rgba(74,138,106,0.7)' : '0 0 6px rgba(200,146,42,0.7)' }} />
            <div className="flex-1 min-w-0">
              <p style={{ fontSize: '15px', color: '#c8b07a', fontFamily: "'Crimson Text', serif" }}>Qwen3-0.6B</p>
              <p style={{ fontSize: '16px', color: '#3a2e1a', fontFamily: 'monospace' }}>{modelReady ? 'Attuned' : 'Not yet summoned'}</p>
            </div>
            {!modelReady && <span style={{ fontSize: '16px', color: '#3a2e1a', fontFamily: 'monospace' }}>~400 MB</span>}
          </div>
        </div>

        {/* Divider */}
        <div className="mb-5" style={{ height: '1px', background: 'linear-gradient(to right, transparent, #2e2416, transparent)' }} />

        <button onClick={onClose} style={{
          width: '100%',
          padding: '10px',
          background: 'transparent',
          border: '1px solid #2e2416',
          color: '#6b4e15',
          fontSize: '16px',
          fontFamily: "'Cinzel', serif",
          letterSpacing: '0.2em',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(200,146,42,0.4)'; e.currentTarget.style.color = '#c8922a' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#2e2416'; e.currentTarget.style.color = '#6b4e15' }}>
          Seal Configuration
        </button>
      </div>
    </div>
  )
}
