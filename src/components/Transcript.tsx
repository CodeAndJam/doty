import { useEffect, useRef, useState } from 'react'
import type { MicPermission } from '../types'

interface SessionMeta {
  file: string
  name: string
  created: string
}

interface Props {
  lines: string[]
  recording: boolean
  asrStatus?: 'idle' | 'loading' | 'ready'
  interimText?: string
  micPermission?: MicPermission
  sessions: SessionMeta[]
  activeSession: string | null
  onNewSession: () => void
  onSwitchSession: (file: string) => void
  onRenameSession: (file: string, name: string) => void
}

export default function Transcript({
  lines,
  recording,
  asrStatus = 'idle',
  interimText = '',
  micPermission,
  sessions,
  activeSession,
  onNewSession,
  onSwitchSession,
  onRenameSession,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  return (
    <div
      className="flex-1 overflow-hidden flex flex-col relative"
      style={{
        background: 'linear-gradient(160deg, #0f0d09, #080705)',
        border: '1px solid #2e2416',
        boxShadow: 'inset 0 1px 0 rgba(200,146,42,0.06), 0 0 20px rgba(0,0,0,0.5)',
      }}
    >
      {/* Corner ornaments */}
      <div
        className="absolute top-0 left-0 w-3 h-3 pointer-events-none"
        style={{
          borderTop: '1px solid rgba(200,146,42,0.4)',
          borderLeft: '1px solid rgba(200,146,42,0.4)',
        }}
      />
      <div
        className="absolute top-0 right-0 w-3 h-3 pointer-events-none"
        style={{
          borderTop: '1px solid rgba(200,146,42,0.4)',
          borderRight: '1px solid rgba(200,146,42,0.4)',
        }}
      />
      <div
        className="absolute bottom-0 left-0 w-3 h-3 pointer-events-none"
        style={{
          borderBottom: '1px solid rgba(200,146,42,0.4)',
          borderLeft: '1px solid rgba(200,146,42,0.4)',
        }}
      />
      <div
        className="absolute bottom-0 right-0 w-3 h-3 pointer-events-none"
        style={{
          borderBottom: '1px solid rgba(200,146,42,0.4)',
          borderRight: '1px solid rgba(200,146,42,0.4)',
        }}
      />

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0"
        style={{
          borderBottom: '1px solid rgba(46,36,22,0.8)',
        }}
      >
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-1"
            style={{
              fontFamily: "'Cinzel', serif",
              fontSize: '13px',
              letterSpacing: '0.15em',
              color: '#6b4e15',
              textTransform: 'uppercase',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {sessions.find((s) => s.file === activeSession)?.name || 'No Session'}
            <span style={{ fontSize: '10px' }}>▼</span>
          </button>
          {showDropdown && (
            <div
              className="absolute top-full left-0 mt-1 z-50 rounded shadow-lg py-1 max-h-48 overflow-y-auto"
              style={{ background: '#1a1408', border: '1px solid #2e2416', minWidth: '180px' }}
            >
              {sessions.map((s) => (
                <div key={s.file} className="flex items-center px-3 py-1.5 hover:bg-[#2e2416] gap-2">
                  {renaming === s.file ? (
                    <input
                      className="flex-1 bg-transparent text-xs outline-none"
                      style={{ color: '#c8b07a' }}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onRenameSession(s.file, renameValue)
                          setRenaming(null)
                        }
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      onBlur={() => {
                        if (renameValue) onRenameSession(s.file, renameValue)
                        setRenaming(null)
                      }}
                      // biome-ignore lint/a11y/noAutofocus: rename input needs immediate focus
                      autoFocus
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className="flex-1 text-left text-xs truncate"
                        style={{ color: s.file === activeSession ? '#c8922a' : '#c8b07a' }}
                        onClick={() => {
                          onSwitchSession(s.file)
                          setShowDropdown(false)
                        }}
                      >
                        {s.name}
                      </button>
                      <button
                        type="button"
                        className="text-xs opacity-50 hover:opacity-100"
                        style={{ color: '#6b4e15' }}
                        onClick={() => {
                          setRenaming(s.file)
                          setRenameValue(s.name)
                        }}
                        title="Rename"
                      >
                        ✎
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {recording && (
            <span
              className="flex items-center gap-1.5"
              style={{
                fontSize: '13px',
                color: asrStatus === 'loading' ? '#c8922a' : '#4a8a6a',
                letterSpacing: '0.1em',
              }}
            >
              <span
                className="w-1 h-1 rounded-full animate-pulse"
                style={{
                  background: asrStatus === 'loading' ? '#c8922a' : '#4a8a6a',
                  boxShadow: asrStatus === 'loading' ? '0 0 4px rgba(200,146,42,0.9)' : '0 0 4px rgba(74,138,106,0.9)',
                }}
              />
              {asrStatus === 'loading' ? 'Awakening...' : 'Inscribing'}
            </span>
          )}
          <button
            type="button"
            onClick={onNewSession}
            className="text-sm px-1.5 rounded hover:bg-[#2e2416]"
            style={{ color: '#6b4e15' }}
            title="New session"
          >
            +
          </button>
        </div>
      </div>

      {/* Permission banner */}
      {(micPermission === 'denied' || micPermission === 'restricted') && (
        <div
          className="mx-3 mt-2 px-3 py-2 rounded text-sm"
          style={{ background: 'rgba(180,60,40,0.15)', border: '1px solid rgba(180,60,40,0.4)', color: '#e8a87c' }}
        >
          <p className="font-medium mb-1">⚠ Microphone access denied</p>
          <p className="text-xs opacity-80 mb-2">
            Doty needs microphone permission to transcribe. Open System Settings to grant access.
          </p>
          <button
            type="button"
            onClick={() => window.doty.micOpenSettings()}
            className="text-xs underline opacity-90 hover:opacity-100"
            style={{ color: '#c8922a' }}
          >
            Open System Settings →
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 select-text cursor-text">
        {lines.length === 0 ? (
          <p style={{ fontSize: '15px', color: '#3a2e1a', fontStyle: 'italic', fontFamily: "'Crimson Text', serif" }}>
            {recording
              ? asrStatus === 'loading'
                ? 'The construct stirs to life...'
                : 'The construct listens...'
              : 'Await the spoken word.'}
          </p>
        ) : (
          lines.map((line, i) => (
            <p
              key={i}
              style={{
                fontSize: '16px',
                color: '#c8b07a',
                lineHeight: '1.6',
                fontFamily: "'Crimson Text', serif",
                borderLeft: '1px solid rgba(46,36,22,0.6)',
                paddingLeft: '8px',
              }}
            >
              {line}
            </p>
          ))
        )}
        {interimText && (
          <p
            style={{
              fontSize: '16px',
              color: '#8a7a5a',
              lineHeight: '1.6',
              fontFamily: "'Crimson Text', serif",
              borderLeft: '1px solid rgba(200,146,42,0.3)',
              paddingLeft: '8px',
              fontStyle: 'italic',
            }}
          >
            {interimText}
          </p>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
