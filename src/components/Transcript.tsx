import { useCallback, useEffect, useRef, useState } from 'react'
import { groupParagraphs } from '../lib/paragraphs'
import { defaultSessionName } from '../lib/sessionName'
import { speakerPrefix } from '../lib/speaker'
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
  /** Discord participant's display name; absent = the DM's microphone. */
  speaker?: string
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
  /** Receives the name the DM typed, or the suggested default. */
  onNewSession: (name: string) => void
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
  const [editingName, setEditingName] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const nameButtonRef = useRef<HTMLButtonElement>(null)
  const [nameValue, setNameValue] = useState('')
  const [creating, setCreating] = useState(false)
  const [createValue, setCreateValue] = useState('')

  // The field only exists while the DM is naming something, so focus and select
  // follow the intent: typing replaces the suggested name instead of appending.
  useEffect(() => {
    if (!editingName && !creating) return
    nameInputRef.current?.focus()
    nameInputRef.current?.select()
  }, [editingName, creating])

  // A rename must not follow the DM to another session's file.
  useEffect(() => {
    setEditingName(false)
    setCreating(false)
  }, [activeSession])

  /** Save the current edit; used by Enter, blur and the chevron beside it. */
  function commitName() {
    if (activeSession && nameValue.trim()) onRenameSession(activeSession, nameValue.trim())
    setEditingName(false)
  }

  function finishCreate(name: string) {
    setCreating(false)
    onNewSession(name.trim() || defaultSessionName())
  }
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

  // Auto-scroll: only if pinned to bottom. Depend on the content too, otherwise
  // new cues arrive off-screen and the "new text" pill never appears.
  useEffect(() => {
    if (pinnedToBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    } else {
      setShowNewTextPill(true)
    }
  }, [pinnedToBottom, segments.length, interimText])

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

  // Group segments into paragraphs — a new voice starts a new one.
  const paragraphs = groupParagraphs(segments)

  // A speaker is only named once the session holds more than one voice; until
  // then a mic-only transcript reads exactly as it always has.
  const hasRemoteSpeakers = segments.some((s) => s.speaker)

  return (
    <div
      className="flex-1 overflow-hidden flex flex-col relative"
      style={{
        background: 'linear-gradient(160deg, #100e0a, #080705)',
        border: '1px solid #3d2f1c',
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

      {/* Header: the session name owns the first line, its metadata the second.
          They used to share one line with five controls and wrapped mid-word. */}
      <div className="shrink-0" style={{ borderBottom: '1px solid rgba(61,47,28,0.9)' }}>
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <div className="relative flex min-w-0 items-center gap-1" data-session-dropdown>
            {creating ? (
              <input
                ref={nameInputRef}
                data-testid="session-name-input"
                aria-label="Name for the new session"
                className="bg-transparent outline-none"
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: '13px',
                  letterSpacing: '0.15em',
                  color: '#e4d6b4',
                  textTransform: 'uppercase',
                  width: '160px',
                  borderBottom: '1px solid rgba(217,164,65,0.4)',
                }}
                value={createValue}
                onChange={(e) => setCreateValue(e.target.value)}
                onKeyDown={(e) => {
                  // Both keys name it: a session is never left uncreated.
                  if (e.key === 'Enter' || e.key === 'Escape') finishCreate(createValue)
                }}
                onBlur={() => finishCreate(createValue)}
              />
            ) : editingName && activeSession ? (
              <input
                ref={nameInputRef}
                data-testid="session-name-input"
                aria-label="Session name"
                className="bg-transparent outline-none"
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: '13px',
                  letterSpacing: '0.15em',
                  color: '#e4d6b4',
                  textTransform: 'uppercase',
                  width: '160px',
                  borderBottom: '1px solid rgba(217,164,65,0.4)',
                }}
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName()
                  // An edit that exists already: Escape puts it back, and gives the
                  // keyboard back to the title it came from.
                  if (e.key === 'Escape') {
                    setEditingName(false)
                    nameButtonRef.current?.focus()
                  }
                }}
                onBlur={commitName}
              />
            ) : (
              <button
                ref={nameButtonRef}
                type="button"
                data-testid="session-name"
                onClick={() => {
                  if (!activeSession) return
                  setShowDropdown(false)
                  setNameValue(sessions.find((s) => s.file === activeSession)?.name ?? '')
                  setEditingName(true)
                }}
                title="Click to rename this session"
                className="min-w-0 truncate"
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: '13px',
                  letterSpacing: '0.15em',
                  color: '#f2e6c9',
                  textTransform: 'uppercase',
                  background: 'none',
                  border: 'none',
                  cursor: 'text',
                  maxWidth: '190px',
                }}
              >
                {sessions.find((s) => s.file === activeSession)?.name || 'No Session'}
              </button>
            )}
            <button
              type="button"
              data-testid="session-list-toggle"
              aria-expanded={showDropdown}
              // mousedown, not click: committing the rename on blur swaps this
              // input for a button, and the click that follows would land on a
              // node that no longer exists — one dead click after every rename.
              onMouseDown={(e) => {
                if (editingName) {
                  e.preventDefault()
                  commitName()
                }
                setShowDropdown((open) => !open)
              }}
              onKeyDown={(e) => {
                // Mouse users toggle on mousedown; the button's own click is a
                // no-op after a rename, so keyboard gets the toggle here.
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                setShowDropdown((open) => !open)
              }}
              aria-haspopup="menu"
              title="Switch session"
              aria-label="Switch session"
              className="p-1 opacity-80 hover:opacity-100"
              style={{ fontSize: '11px', color: '#a5813f', background: 'none', border: 'none' }}
            >
              ▼
            </button>
            {showDropdown && (
              <div
                className="absolute top-full left-0 mt-1 z-50 rounded shadow-lg py-1 max-h-48 overflow-y-auto"
                style={{ background: '#17130c', border: '1px solid #3d2f1c', minWidth: '180px' }}
              >
                {sessions.map((s) => (
                  <div key={s.file} className="flex items-center px-3 py-1.5 hover:bg-[#3d2f1c] gap-2">
                    {renaming === s.file ? (
                      <input
                        className="flex-1 bg-transparent outline-none"
                        style={{ color: '#e4d6b4', fontSize: '13px' }}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (renameValue.trim()) onRenameSession(s.file, renameValue.trim())
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
                          className="flex-1 text-left truncate"
                          style={{ fontSize: '13px', color: s.file === activeSession ? '#d9a441' : '#e4d6b4' }}
                          onClick={() => {
                            onSwitchSession(s.file)
                            setShowDropdown(false)
                          }}
                        >
                          {s.name}
                        </button>
                        <button
                          type="button"
                          className="p-1 opacity-70 hover:opacity-100"
                          style={{ color: '#a5813f', fontSize: '13px' }}
                          onClick={() => {
                            setRenaming(s.file)
                            setRenameValue(s.name)
                          }}
                          title="Rename"
                          aria-label={`Rename ${s.name}`}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="p-1 opacity-70 hover:opacity-100"
                          style={{ color: '#b43c28', fontSize: '13px' }}
                          onClick={() => {
                            if (window.confirm(`Delete session "${s.name}"?`)) onDeleteSession(s.file)
                          }}
                          title="Delete"
                          aria-label={`Delete ${s.name}`}
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
          <button
            type="button"
            onClick={() => {
              // An in-app field, not `window.prompt`: Electron does not implement
              // it, and a blocking dialog during a recording helps nobody.
              setCreateValue(defaultSessionName())
              setCreating(true)
            }}
            className="shrink-0 px-2 py-1 rounded hover:bg-[#3d2f1c]"
            style={{ color: '#a5813f', fontSize: '14px' }}
            title="New session"
            aria-label="New session"
            data-testid="new-session"
          >
            +
          </button>
        </div>
        <div className="flex items-center gap-3 px-4 pt-1.5 pb-2.5">
          {recording && (
            <span className="data-label" style={{ color: '#ef4444' }} data-testid="recording-indicator">
              ● recording
            </span>
          )}
          {elapsed && (
            <span className="data-label tabular-nums" style={{ color: '#6dbf95' }}>
              {elapsed}
            </span>
          )}
          {wordCount > 0 && (
            <span className="data-label tabular-nums" style={{ color: '#9d8b66' }}>
              {wordCount} words
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onCopyTranscript}
            className="px-2 py-1 opacity-80 hover:opacity-100"
            style={{ color: '#b9a683', fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' }}
            title="Copy transcript"
            aria-label="Copy transcript"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={onExportTranscript}
            className="px-2 py-1 opacity-80 hover:opacity-100"
            style={{ color: '#b9a683', fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' }}
            title="Export as markdown"
            aria-label="Export transcript as markdown"
          >
            Export
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
            style={{ color: '#d9a441' }}
          >
            Open System Settings →
          </button>
        </div>
      )}

      {/* Scrollable content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label="Session transcript"
        className="flex-1 overflow-y-auto px-4 py-3 select-text cursor-text"
      >
        {paragraphs.length === 0 && !interimText ? (
          <p style={{ fontSize: '15px', color: '#9d8b66', fontStyle: 'italic', fontFamily: "'Crimson Text', serif" }}>
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
                    color: '#a89b7f',
                    lineHeight: '1.8',
                    fontFamily: "'IBM Plex Mono', monospace",
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
            const first = para.find((s) => s.text)
            const firstTs = first?.elapsedMs ?? 0
            const speaker = speakerPrefix(first?.speaker, hasRemoteSpeakers)
            const paragraphText = para.map((s) => s.text).join(' ')
            return (
              <div key={pi} className="group relative" style={{ marginBottom: '16px' }}>
                {firstTs > 0 && (
                  <span
                    className="absolute -left-0 top-0 text-[11px] tabular-nums select-none opacity-0 group-hover:opacity-80 group-focus-within:opacity-80 transition-opacity"
                    style={{
                      color: '#a89b7f',
                      fontFamily: "'IBM Plex Mono', monospace",
                      transform: 'translateX(-100%) translateX(-8px)',
                    }}
                  >
                    {formatTime(firstTs)}
                  </span>
                )}
                <p
                  style={{
                    fontSize: '17px',
                    color: '#e4d6b4',
                    lineHeight: '1.65',
                    fontFamily: "'Crimson Text', serif",
                    borderLeft: '1px solid rgba(122,97,56,0.45)',
                    paddingLeft: '12px',
                  }}
                >
                  {speaker && (
                    <span
                      style={{
                        color: '#d9a441',
                        fontFamily: "'Cinzel', serif",
                        fontSize: '14px',
                        letterSpacing: '0.06em',
                        marginRight: '6px',
                      }}
                    >
                      {speaker}:
                    </span>
                  )}
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
                fontSize: '17px',
                color: '#b9a683',
                lineHeight: '1.65',
                fontFamily: "'Crimson Text', serif",
                borderLeft: '1px solid rgba(217,164,65,0.35)',
                paddingLeft: '12px',
                fontStyle: 'italic',
              }}
            >
              {interimText}
              <span
                style={{
                  display: 'inline-block',
                  width: '2px',
                  height: '1em',
                  backgroundColor: '#d9a441',
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
            color: '#d9a441',
            backdropFilter: 'blur(8px)',
          }}
        >
          ↓ New text
        </button>
      )}
    </div>
  )
}
