import { useCallback, useEffect, useRef, useState } from 'react'
import type { MicPermission } from '../types'

interface SessionMeta {
  file: string
  name: string
  created: string
}

/** A segment of transcribed text with its timestamp */
export interface TranscriptSegment {
  text: string
  elapsedMs: number
  /** true = system message (model switch, etc) */
  system?: boolean
  /** true = starts a new paragraph (after long silence) */
  paragraphStart?: boolean
}

interface Props {
  segments: TranscriptSegment[]
  recording: boolean
  asrStatus?: 'idle' | 'loading' | 'ready' | 'crashed'
  interimText?: string
  micPermission?: MicPermission
  sessions: SessionMeta[]
  activeSession: string | null
  sessionStartTime: number | null
  onNewSession: () => void
  onSwitchSession: (file: string) => void
  onRenameSession: (file: string, name: string) => void
  onDeleteSession: (file: string) => void
  onCopyTranscript: () => void
  onExportTranscript: () => void
  availableModels: Array<{ id: string; label: string; ready: boolean }>
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function Transcript({
  segments,
  recording,
  asrStatus = 'idle',
  interimText = '',
  micPermission,
  sessions,
  activeSession,
  sessionStartTime,
  onNewSession,
  onSwitchSession,
  onRenameSession,
  onDeleteSession,
  onCopyTranscript,
  onExportTranscript,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [elapsed, setElapsed] = useState('')
  const [pinnedToBottom, setPinnedToBottom] = useState(true)
  const [showNewTextPill, setShowNewTextPill] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Word count
  const wordCount = segments.reduce((acc, s) => (s.system ? acc : acc + s.text.split(/\s+/).filter(Boolean).length), 0)

  // Elapsed timer
  useEffect(() => {
    if (!sessionStartTime || !recording) {
      setElapsed('')
      return
    }
    const tick = () => {
      const s = Math.floor((Date.now() - sessionStartTime) / 1000)
      const m = Math.floor(s / 60)
      const sec = s % 60
      setElapsed(`${m}:${String(sec).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [sessionStartTime, recording])

  // Auto-scroll: only if pinned to bottom
  useEffect(() => {
    if (pinnedToBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    } else {
      setShowNewTextPill(true)
    }
  }, [pinnedToBottom])

  // Detect scroll position to manage pinned state
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setPinnedToBottom(atBottom)
    if (atBottom) setShowNewTextPill(false)
  }, [])

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    setPinnedToBottom(true)
    setShowNewTextPill(false)
  }

  // Session dropdown close on outside click
  useEffect(() => {
    if (!showDropdown) return
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-session-dropdown]')) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showDropdown])

  // Group segments into paragraphs
  const paragraphs: TranscriptSegment[][] = []
  let currentParagraph: TranscriptSegment[] = []
  for (const seg of segments) {
    if (seg.system || seg.paragraphStart) {
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph)
        currentParagraph = []
      }
      if (seg.system) {
        paragraphs.push([seg])
      } else {
        currentParagraph.push(seg)
      }
    } else {
      currentParagraph.push(seg)
    }
  }
  if (currentParagraph.length > 0) paragraphs.push(currentParagraph)

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
        style={{ borderTop: '1px solid rgba(200,146,42,0.4)', borderLeft: '1px solid rgba(200,146,42,0.4)' }}
      />
      <div
        className="absolute top-0 right-0 w-3 h-3 pointer-events-none"
        style={{ borderTop: '1px solid rgba(200,146,42,0.4)', borderRight: '1px solid rgba(200,146,42,0.4)' }}
      />
      <div
        className="absolute bottom-0 left-0 w-3 h-3 pointer-events-none"
        style={{ borderBottom: '1px solid rgba(200,146,42,0.4)', borderLeft: '1px solid rgba(200,146,42,0.4)' }}
      />
      <div
        className="absolute bottom-0 right-0 w-3 h-3 pointer-events-none"
        style={{ borderBottom: '1px solid rgba(200,146,42,0.4)', borderRight: '1px solid rgba(200,146,42,0.4)' }}
      />

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0"
        style={{ borderBottom: '1px solid rgba(46,36,22,0.8)' }}
      >
        <div className="relative" data-session-dropdown>
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
                      <button
                        type="button"
                        className="text-xs opacity-50 hover:opacity-100"
                        style={{ color: '#b43c28' }}
                        onClick={() => {
                          if (window.confirm(`Delete session "${s.name}"?`)) onDeleteSession(s.file)
                        }}
                        title="Delete"
                      >
                        🗑
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {recording && (
            <span className="text-xs" style={{ color: '#ef4444' }} data-testid="recording-indicator">
              ●
            </span>
          )}
          {elapsed && (
            <span className="text-xs tabular-nums" style={{ color: '#4a8a6a' }}>
              {elapsed}
            </span>
          )}
          {wordCount > 0 && (
            <span className="text-xs tabular-nums" style={{ color: '#5a5a4a' }}>
              {wordCount} words
            </span>
          )}
          <button
            type="button"
            onClick={onCopyTranscript}
            className="text-xs opacity-50 hover:opacity-100 px-1"
            style={{ color: '#6b4e15' }}
            title="Copy transcript"
          >
            📋
          </button>
          <button
            type="button"
            onClick={onExportTranscript}
            className="text-xs opacity-50 hover:opacity-100 px-1"
            style={{ color: '#6b4e15' }}
            title="Export as markdown"
          >
            ↗
          </button>
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
          <p className="text-xs opacity-80 mb-2">Doty needs microphone permission to transcribe.</p>
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

      {/* Scrollable content */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-3 select-text cursor-text">
        {paragraphs.length === 0 && !interimText ? (
          <p style={{ fontSize: '15px', color: '#3a2e1a', fontStyle: 'italic', fontFamily: "'Crimson Text', serif" }}>
            {recording
              ? asrStatus === 'loading'
                ? 'The construct stirs to life...'
                : 'The construct listens...'
              : 'Await the spoken word.'}
          </p>
        ) : (
          paragraphs.map((para, pi) => {
            // System message (model switch, etc)
            if (para.length === 1 && para[0].system) {
              return (
                <p
                  key={pi}
                  style={{
                    fontSize: '12px',
                    color: '#6a6a5a',
                    lineHeight: '1.8',
                    fontFamily: 'monospace',
                    textAlign: 'center',
                    opacity: 0.7,
                    margin: '8px 0',
                  }}
                >
                  {para[0].text}
                </p>
              )
            }
            // Regular paragraph — flowing text with timestamp on first segment
            const firstTs = para[0]?.elapsedMs
            const paragraphText = para.map((s) => s.text).join(' ')
            return (
              <div key={pi} className="group relative" style={{ marginBottom: '12px' }}>
                {firstTs > 0 && (
                  <span
                    className="absolute -left-0 top-0 text-[10px] tabular-nums select-none opacity-0 group-hover:opacity-60 transition-opacity"
                    style={{
                      color: '#5a5a4a',
                      fontFamily: 'monospace',
                      transform: 'translateX(-100%) translateX(-8px)',
                    }}
                  >
                    {formatTime(firstTs)}
                  </span>
                )}
                <p
                  style={{
                    fontSize: '16px',
                    color: '#c8b07a',
                    lineHeight: '1.7',
                    fontFamily: "'Crimson Text', serif",
                    borderLeft: '1px solid rgba(46,36,22,0.6)',
                    paddingLeft: '10px',
                  }}
                >
                  {paragraphText}
                </p>
              </div>
            )
          })
        )}

        {/* Live interim text with cursor */}
        {interimText && (
          <div style={{ marginBottom: '12px' }}>
            <p
              style={{
                fontSize: '16px',
                color: '#8a7a5a',
                lineHeight: '1.7',
                fontFamily: "'Crimson Text', serif",
                borderLeft: '1px solid rgba(200,146,42,0.3)',
                paddingLeft: '10px',
                fontStyle: 'italic',
              }}
            >
              {interimText}
              <span
                style={{
                  display: 'inline-block',
                  width: '2px',
                  height: '1em',
                  backgroundColor: '#c8922a',
                  marginLeft: '2px',
                  verticalAlign: 'text-bottom',
                  animation: 'blink 1s step-end infinite',
                }}
              />
            </p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* "New text" pill — shown when user scrolled up and new text arrived */}
      {showNewTextPill && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs shadow-lg transition-all hover:scale-105"
          style={{
            background: 'rgba(200,146,42,0.2)',
            border: '1px solid rgba(200,146,42,0.4)',
            color: '#c8922a',
            backdropFilter: 'blur(8px)',
          }}
        >
          ↓ New text
        </button>
      )}
    </div>
  )
}
