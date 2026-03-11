import { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'
import type { TrackMeta } from '../types'
import { PlayIcon, PauseIcon, PinIcon, ChevronUp, ChevronDown, InfoIcon } from './Icons'
import { trackName } from './PlayerBar'

// ── Helpers ──────────────────────────────────────────────────────────────────

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function MetaRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === '') return null
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span style={{ color: '#6b4e15', fontSize: '11px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ color: '#8a7050', fontSize: '11px', fontFamily: "'Crimson Text', serif", textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function MetadataTooltip({ meta, anchorRef }: { meta: TrackMeta; anchorRef: React.RefObject<HTMLDivElement | null> }) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    if (!anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setPos({ top: rect.top, left: rect.left, width: rect.width })
  }, [anchorRef])

  if (!pos) return null

  return ReactDOM.createPortal(
    <div className="fixed px-3 py-2" style={{
      zIndex: 9999,
      top: Math.max(8, pos.top - 8),
      left: pos.left,
      width: pos.width,
      transform: 'translateY(-100%)',
      background: '#0f0d09',
      border: '1px solid rgba(200,146,42,0.3)',
      boxShadow: '0 -4px 20px rgba(0,0,0,0.8), 0 4px 20px rgba(0,0,0,0.6)',
    }}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0">
        <MetaRow label="BPM" value={meta.bpm ? `${Math.round(meta.bpm)} (${Math.round(meta.bpmConfidence * 100)}%)` : null} />
        <MetaRow label="Key" value={meta.key && meta.scale ? `${meta.key} ${meta.scale}` : meta.key || null} />
        <MetaRow label="Energy" value={meta.energy != null ? `${Math.round(meta.energy * 100)}%` : null} />
        <MetaRow label="Dance" value={meta.danceability != null ? `${Math.round(meta.danceability * 100)}%` : null} />
        <MetaRow label="Duration" value={meta.duration ? formatDuration(meta.duration) : null} />
        <MetaRow label="Artist" value={meta.artist} />
        <MetaRow label="Album" value={meta.album} />
        <MetaRow label="Genre" value={meta.genre} />
        <MetaRow label="Year" value={meta.year} />
        <MetaRow label="Codec" value={meta.codec} />
        <MetaRow label="Bitrate" value={meta.bitrate ? `${meta.bitrate} kbps` : null} />
        <MetaRow label="Sample" value={meta.sampleRate ? `${(meta.sampleRate / 1000).toFixed(1)} kHz` : null} />
      </div>
    </div>,
    document.body
  )
}

// ── TrackCard ─────────────────────────────────────────────────────────────────

interface TrackCardProps {
  filename: string
  isPlaying: boolean
  isPinned: boolean
  rank: number
  showReorder: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  meta?: TrackMeta
  onPlay: () => void
  onPin: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export default function TrackCard({
  filename, isPlaying, isPinned, rank, showReorder,
  canMoveUp, canMoveDown, meta, onPlay, onPin, onMoveUp, onMoveDown,
}: TrackCardProps) {
  const [expanded, setExpanded] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const name = trackName(filename)

  return (
    <div
      ref={cardRef}
      data-testid="track-card"
      className="relative transition-all group flex-1"
      style={{
        minHeight: '36px',
        maxHeight: '64px',
        background: isPlaying
          ? 'linear-gradient(135deg, rgba(200,146,42,0.12), rgba(107,78,21,0.06))'
          : 'linear-gradient(160deg, #0f0d09, #080705)',
        border: `1px solid ${isPinned ? 'rgba(200,146,42,0.35)' : isPlaying ? 'rgba(200,146,42,0.5)' : '#2e2416'}`,
        boxShadow: isPlaying
          ? '0 0 16px rgba(200,146,42,0.2), inset 0 1px 0 rgba(200,146,42,0.08)'
          : 'inset 0 1px 0 rgba(255,255,255,0.02)',
      }}
    >
      <div className="flex items-center gap-3 px-3 h-full">
        <button onClick={onPlay} className="w-9 h-9 flex items-center justify-center shrink-0" style={{
          border: `1px solid ${isPlaying ? 'rgba(200,146,42,0.5)' : '#2e2416'}`,
          background: isPlaying ? 'rgba(200,146,42,0.1)' : 'transparent',
          borderRadius: '4px',
        }}>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <span className="flex-1 min-w-0 truncate" style={{
          fontFamily: "'Crimson Text', serif",
          fontSize: '17px',
          color: isPlaying ? '#e8d5a3' : '#8a7050',
        }}>
          {name}
        </span>

        {showReorder && (
          <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onMoveUp} disabled={!canMoveUp} className="p-1.5" style={{ opacity: canMoveUp ? 1 : 0.3 }}>
              <ChevronUp />
            </button>
            <button onClick={onMoveDown} disabled={!canMoveDown} className="p-1.5" style={{ opacity: canMoveDown ? 1 : 0.3 }}>
              <ChevronDown />
            </button>
          </div>
        )}

        {meta && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="w-8 h-8 flex items-center justify-center opacity-40 hover:opacity-100 transition-opacity"
            title="Track details"
            style={{ color: expanded ? '#c8922a' : undefined }}
          >
            <InfoIcon />
          </button>
        )}

        <button
          onClick={onPin}
          className="w-8 h-8 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
          title={isPinned ? 'Unpin' : 'Pin'}
        >
          <PinIcon filled={isPinned} />
        </button>

        <span className="absolute top-1.5 right-1.5" style={{
          fontFamily: 'monospace', fontSize: '11px',
          color: isPlaying ? 'rgba(200,146,42,0.4)' : '#2e2416',
          pointerEvents: 'none',
        }}>
          {String(rank).padStart(2, '0')}
        </span>
      </div>

      {expanded && meta && <MetadataTooltip meta={meta} anchorRef={cardRef} />}
    </div>
  )
}
