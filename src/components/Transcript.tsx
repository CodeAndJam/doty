import { useEffect, useRef } from 'react'

interface Props {
  lines: string[]
  recording: boolean
  asrStatus?: 'idle' | 'loading' | 'ready'
}

export default function Transcript({ lines, recording, asrStatus = 'idle' }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

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
        <span
          style={{
            fontFamily: "'Cinzel', serif",
            fontSize: '15px',
            letterSpacing: '0.25em',
            color: '#6b4e15',
            textTransform: 'uppercase',
          }}
        >
          Scribe's Record
        </span>
        {recording && (
          <span
            className="flex items-center gap-1.5"
            style={{ fontSize: '15px', color: asrStatus === 'loading' ? '#c8922a' : '#4a8a6a', letterSpacing: '0.1em' }}
          >
            <span
              className="w-1 h-1 rounded-full animate-pulse"
              style={{
                background: asrStatus === 'loading' ? '#c8922a' : '#4a8a6a',
                boxShadow: asrStatus === 'loading' ? '0 0 4px rgba(200,146,42,0.9)' : '0 0 4px rgba(74,138,106,0.9)',
              }}
            />
            {asrStatus === 'loading' ? 'Doty awakens...' : 'Inscribing'}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
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
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
