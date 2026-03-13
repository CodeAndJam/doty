import { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'
import type { TrackMeta } from '../types'
import { PlayIcon, PauseIcon, PinIcon, ChevronUp, ChevronDown, InfoIcon, TagIcon } from './Icons'
import { trackName } from './PlayerBar'
import TagInput from './TagInput'

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

/** Extract directory path from a filename (everything before the last separator). */
function dirName(filename: string): string {
  const idx = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'))
  return idx > 0 ? filename.substring(0, idx) : ''
}

function MetadataTooltip({ meta, filename, anchorRef }: { meta: TrackMeta; filename: string; anchorRef: React.RefObject<HTMLDivElement | null> }) {
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
        {dirName(filename) && <div className="col-span-2"><MetaRow label="Dir" value={dirName(filename)} /></div>}
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
  tags?: string[]
  allTags?: string[]
  onPlay: () => void
  onPin: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onTagsChange?: (tags: string[]) => void
  onPlayNext?: () => void
  onAddToQueue?: () => void
}

export default function TrackCard({
  filename, isPlaying, isPinned, rank, showReorder,
  canMoveUp, canMoveDown, meta, tags = [], allTags = [],
  onPlay, onPin, onMoveUp, onMoveDown, onTagsChange,
  onPlayNext, onAddToQueue,
}: TrackCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [editingTags, setEditingTags] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const name = trackName(filename)

  return (
    <div
      ref={cardRef}
      data-testid="track-card"
      className="relative transition-all group flex-1"
      style={{
        minHeight: '36px',
        maxHeight: editingTags ? 'none' : '64px',
        overflow: editingTags ? 'visible' : undefined,
        zIndex: editingTags ? 20 : undefined,
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

        {/* Tag pills (read-only display) */}
        {tags.length > 0 && !editingTags && (
          <div className="flex items-center gap-1 shrink-0 max-w-[40%] overflow-hidden">
            {tags.slice(0, 3).map(tag => (
              <span
                key={tag}
                className="px-1.5 truncate"
                style={{
                  background: 'rgba(200,146,42,0.12)',
                  border: '1px solid rgba(200,146,42,0.25)',
                  fontSize: '10px',
                  fontFamily: 'monospace',
                  color: '#c8922a',
                  lineHeight: '16px',
                  maxWidth: '80px',
                }}
              >
                {tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#6b4e15' }}>
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}

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

        {/* Tag edit toggle */}
        {onTagsChange && (
          <button
            onClick={() => setEditingTags(e => !e)}
            className="w-8 h-8 flex items-center justify-center opacity-40 hover:opacity-100 transition-opacity"
            title="Edit tags"
            style={{ color: editingTags ? '#c8922a' : undefined, fontSize: '14px' }}
          >
            <TagIcon />
          </button>
        )}

        {/* Queue actions */}
        {(onPlayNext || onAddToQueue) && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            {onPlayNext && (
              <button
                onClick={onPlayNext}
                className="px-1.5 py-0.5 hover:opacity-80 transition-opacity"
                title="Play next"
                style={{
                  fontSize: '9px',
                  fontFamily: 'monospace',
                  color: '#6b4e15',
                  border: '1px solid rgba(200,146,42,0.2)',
                  lineHeight: '14px',
                }}
              >
                NEXT
              </button>
            )}
            {onAddToQueue && (
              <button
                onClick={onAddToQueue}
                className="px-1.5 py-0.5 hover:opacity-80 transition-opacity"
                title="Add to queue"
                style={{
                  fontSize: '9px',
                  fontFamily: 'monospace',
                  color: '#6b4e15',
                  border: '1px solid rgba(200,146,42,0.2)',
                  lineHeight: '14px',
                }}
              >
                QUEUE
              </button>
            )}
          </div>
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

      {expanded && meta && <MetadataTooltip meta={meta} filename={filename} anchorRef={cardRef} />}

      {/* Inline tag editor */}
      {editingTags && onTagsChange && (
        <div className="px-3 pb-2 pt-1" style={{ borderTop: '1px solid rgba(46,36,22,0.3)' }}>
          <TagInput tags={tags} allTags={allTags} onChange={onTagsChange} />
        </div>
      )}
    </div>
  )
}
