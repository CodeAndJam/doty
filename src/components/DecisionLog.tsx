import type { DecisionLogEntry } from '../types'

interface Props {
  entries: DecisionLogEntry[]
  onClose: () => void
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function shortFilename(path: string | null): string {
  if (!path) return '—'
  const name = path.replace(/\.[^.]+$/, '')
  return name.length > 30 ? `${name.slice(0, 27)}...` : name
}

export default function DecisionLog({ entries, onClose }: Props) {
  return (
    <div
      style={{
        background: 'rgba(20,16,10,0.95)',
        border: '1px solid rgba(107,78,21,0.3)',
        borderRadius: '4px',
        padding: '6px 8px',
        maxHeight: '200px',
        overflowY: 'auto',
        fontSize: '10px',
        fontFamily: 'monospace',
        color: '#8a7a5a',
        lineHeight: '1.5',
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span style={{ color: '#c8922a', fontSize: '9px', letterSpacing: '0.05em' }}>DECISION LOG (beta)</span>
        <button
          type="button"
          onClick={onClose}
          style={{ color: '#6b4e15', fontSize: '10px', padding: '0 2px' }}
          title="Close decision log"
        >
          x
        </button>
      </div>
      {entries.length === 0 && <div style={{ color: '#5a4a30', fontStyle: 'italic' }}>No decisions yet</div>}
      {entries.map((e, i) => (
        <div
          key={`${e.timestamp}-${i}`}
          style={{
            borderTop: i > 0 ? '1px solid rgba(107,78,21,0.15)' : undefined,
            paddingTop: i > 0 ? '2px' : undefined,
            marginTop: i > 0 ? '2px' : undefined,
          }}
        >
          <span style={{ color: '#5a4a30' }}>{formatTime(e.timestamp)}</span>{' '}
          {e.ranker && <span style={{ color: e.ranker === 'reranker' ? '#c8922a' : '#6b4e15' }}>[{e.ranker}]</span>}
          {e.action && (
            <span
              style={{
                color:
                  e.action === 'play' || e.action === 'sfx_play'
                    ? '#4a9'
                    : e.action === 'cancel'
                      ? '#c44'
                      : e.action === 'pending'
                        ? '#ca2'
                        : '#6b4e15',
              }}
            >
              {' '}
              {e.action}
            </span>
          )}{' '}
          <span style={{ color: '#a89060' }}>{shortFilename(e.topTrack)}</span>
          {e.confidence > 0 && <span style={{ color: '#5a4a30' }}> {(e.confidence * 100).toFixed(0)}%</span>}
          {e.reason && <span style={{ color: '#4a3a20' }}> — {e.reason}</span>}
          {e.transcriptSnippet && (
            <div
              style={{
                color: '#3a3020',
                fontSize: '9px',
                marginLeft: '8px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              "{e.transcriptSnippet.slice(0, 80)}"
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
