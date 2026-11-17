import { useState } from 'react'
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

/** Tab-separated so it pastes into a spreadsheet or a chat without cleanup. */
export function exportText(entries: DecisionLogEntry[]): string {
  const head = 'time\tranker\taction\ttrack\tconfidence\treason\ttranscript'
  const rows = entries.map((e) =>
    [
      new Date(e.timestamp).toISOString(),
      e.ranker ?? '-',
      e.action ?? '-',
      e.topTrack ?? '-',
      e.confidence > 0 ? `${(e.confidence * 100).toFixed(0)}%` : '-',
      (e.reason ?? '').replace(/\t/g, ' '),
      (e.transcriptSnippet ?? '').replace(/\t/g, ' '),
    ].join('\t'),
  )
  return [head, ...rows].join('\n')
}

export default function DecisionLog({ entries, onClose }: Props) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard
      .writeText(exportText(entries))
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  return (
    <div
      style={{
        background: 'rgba(20,16,10,0.95)',
        border: '1px solid rgba(107,78,21,0.3)',
        borderRadius: '4px',
        padding: '6px 8px',
        maxHeight: '200px',
        overflowY: 'auto',
        fontSize: '11px',
        fontFamily: "'IBM Plex Mono', monospace",
        color: '#b9a683',
        lineHeight: '1.5',
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span style={{ color: '#d9a441', fontSize: '11px', letterSpacing: '0.05em' }}>DECISION LOG (beta)</span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={copy}
            style={{ color: copied ? '#4a9' : '#a5813f', fontSize: '11px' }}
            title="Copy the log as tab-separated text, for feedback"
          >
            {copied ? 'copied' : 'copy'}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ color: '#a5813f', fontSize: '11px', padding: '0 2px' }}
            title="Close decision log"
          >
            x
          </button>
        </span>
      </div>
      {entries.length === 0 && <div style={{ color: '#a89573', fontStyle: 'italic' }}>No decisions yet</div>}
      {entries.map((e, i) => (
        <div
          key={`${e.timestamp}-${i}`}
          style={{
            borderTop: i > 0 ? '1px solid rgba(107,78,21,0.15)' : undefined,
            paddingTop: i > 0 ? '2px' : undefined,
            marginTop: i > 0 ? '2px' : undefined,
          }}
        >
          <span style={{ color: '#a89573' }}>{formatTime(e.timestamp)}</span>{' '}
          {e.ranker && <span style={{ color: e.ranker === 'model' ? '#d9a441' : '#a5813f' }}>[{e.ranker}]</span>}
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
                        : '#a5813f',
              }}
            >
              {' '}
              {e.action}
            </span>
          )}{' '}
          <span style={{ color: '#c4b08c' }}>{shortFilename(e.topTrack)}</span>
          {e.confidence > 0 && <span style={{ color: '#a89573' }}> {(e.confidence * 100).toFixed(0)}%</span>}
          {e.reason && <span style={{ color: '#96825f' }}> — {e.reason}</span>}
          {e.transcriptSnippet && (
            <div
              style={{
                color: '#9d8b66',
                fontSize: '11px',
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
