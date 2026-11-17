import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { formatProbability } from '../lib/confidence'
import { formatTime } from '../lib/formatTime'
import type { TrackMeta } from '../types'
import { ChevronDown, ChevronUp, InfoIcon, PauseIcon, PinIcon, PlayIcon, TagIcon } from './Icons'
import { trackName } from './PlayerBar'
import TagInput from './TagInput'

// ── Helpers ──────────────────────────────────────────────────────────────────

function MetaRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === '') return null
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span
        style={{ color: '#a5813f', fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", whiteSpace: 'nowrap' }}
      >
        {label}
      </span>
      <span style={{ color: '#b9a683', fontSize: '11px', fontFamily: "'Crimson Text', serif", textAlign: 'right' }}>
        {value}
      </span>
    </div>
  )
}

/** Extract directory path from a filename (everything before the last separator). */
function dirName(filename: string): string {
  const idx = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'))
  return idx > 0 ? filename.substring(0, idx) : ''
}

function MetadataTooltip({
  meta,
  filename,
  anchorRef,
}: {
  meta: TrackMeta
  filename: string
  anchorRef: React.RefObject<HTMLDivElement | null>
}) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number; bottom: number } | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [flipBelow, setFlipBelow] = useState(false)

  useEffect(() => {
    if (!anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setPos({ top: rect.top, left: rect.left, width: rect.width, bottom: rect.bottom })
  }, [anchorRef])

  // After first render, check if tooltip overflows above viewport and flip below if needed
  useEffect(() => {
    if (!tooltipRef.current || !pos) return
    const tooltipHeight = tooltipRef.current.getBoundingClientRect().height
    // If tooltip would go above the viewport (or within 8px of top), flip below the card
    if (pos.top - tooltipHeight - 8 < 8) {
      setFlipBelow(true)
    }
  }, [pos])

  if (!pos) return null

  return ReactDOM.createPortal(
    <div
      ref={tooltipRef}
      className="fixed px-3 py-2"
      style={{
        zIndex: 99999,
        top: flipBelow ? pos.bottom + 8 : Math.max(8, pos.top - 8),
        left: pos.left,
        width: pos.width,
        transform: flipBelow ? undefined : 'translateY(-100%)',
        background: '#100e0a',
        border: '1px solid rgba(200,146,42,0.3)',
        boxShadow: flipBelow
          ? '0 4px 20px rgba(0,0,0,0.8), 0 -4px 20px rgba(0,0,0,0.6)'
          : '0 -4px 20px rgba(0,0,0,0.8), 0 4px 20px rgba(0,0,0,0.6)',
      }}
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-0">
        {dirName(filename) && (
          <div className="col-span-2">
            <MetaRow label="Dir" value={dirName(filename)} />
          </div>
        )}
        <MetaRow
          label="BPM"
          value={meta.bpm ? `${Math.round(meta.bpm)} (${Math.round(meta.bpmConfidence * 100)}%)` : null}
        />
        <MetaRow label="Key" value={meta.key && meta.scale ? `${meta.key} ${meta.scale}` : meta.key || null} />
        <MetaRow label="Energy" value={meta.energy != null ? `${Math.round(meta.energy * 100)}%` : null} />
        <MetaRow label="Dance" value={meta.danceability != null ? `${Math.round(meta.danceability * 100)}%` : null} />
        <MetaRow label="Duration" value={meta.duration ? formatTime(meta.duration) : null} />
        <MetaRow label="Artist" value={meta.artist} />
        <MetaRow label="Album" value={meta.album} />
        <MetaRow label="Genre" value={meta.genre} />
        <MetaRow label="Year" value={meta.year} />
        <MetaRow label="Codec" value={meta.codec} />
        <MetaRow label="Bitrate" value={meta.bitrate ? `${meta.bitrate} kbps` : null} />
        <MetaRow label="Sample" value={meta.sampleRate ? `${(meta.sampleRate / 1000).toFixed(1)} kHz` : null} />
      </div>
    </div>,
    document.body,
  )
}

// ── TrackCard ─────────────────────────────────────────────────────────────────

interface TrackCardProps {
  filename: string
  isPlaying: boolean
  isPinned: boolean
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
  /** Model probability that this is the right track, when the ranker produced one. */
  probability?: number
  /** Moves this file to the other library; the label says which. */
  onMoveTo?: (target: 'music' | 'sfx') => void
  /** Which library the file is in now, when it is known. */
  kind?: 'music' | 'sfx'
  onTagsChange?: (tags: string[]) => void
  onPlayNext?: () => void
  onAddToQueue?: () => void
}

export default function TrackCard({
  filename,
  isPlaying,
  isPinned,
  showReorder,
  canMoveUp,
  canMoveDown,
  meta,
  tags = [],
  allTags = [],
  probability,
  onPlay,
  onPin,
  onMoveUp,
  onMoveDown,
  onTagsChange,
  onMoveTo,
  kind,
  onPlayNext,
  onAddToQueue,
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
        minHeight: '48px',
        maxHeight: editingTags ? 'none' : '64px',
        overflow: editingTags ? 'visible' : 'hidden',
        zIndex: editingTags ? 20 : undefined,
        background: isPlaying
          ? 'linear-gradient(135deg, rgba(217,164,65,0.14), rgba(165,129,63,0.06))'
          : 'linear-gradient(160deg, #100e0a, #080705)',
        border: `1px solid ${isPinned ? 'rgba(217,164,65,0.4)' : isPlaying ? 'rgba(217,164,65,0.55)' : '#3d2f1c'}`,
        boxShadow: isPlaying
          ? '0 0 16px rgba(217,164,65,0.18), inset 0 1px 0 rgba(217,164,65,0.08)'
          : 'inset 0 1px 0 rgba(255,255,255,0.02)',
      }}
    >
      {/* Hover/focus tint: the whole row answers the pointer and the keyboard. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
        style={{ background: 'rgba(217,164,65,0.05)' }}
      />
      <div className="relative flex items-center gap-3 px-3 h-full">
        <button
          type="button"
          onClick={onPlay}
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? `Pause ${name}` : `Play ${name}`}
          className="w-10 h-10 flex items-center justify-center shrink-0 transition-colors hover:bg-[rgba(217,164,65,0.12)]"
          style={{
            border: `1px solid ${isPlaying ? 'rgba(217,164,65,0.55)' : '#7a6138'}`,
            background: isPlaying ? 'rgba(217,164,65,0.1)' : 'transparent',
            borderRadius: '3px',
          }}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <span
          className="flex-1 min-w-0"
          style={{
            fontFamily: "'Crimson Text', serif",
            fontSize: '17px',
            color: isPlaying ? '#f2e6c9' : '#e4d6b4',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={name}
        >
          {name}
        </span>
        {probability !== undefined && (
          <span
            data-testid="track-probability"
            title="The model's probability that this is the right track, out of the candidates it ranked"
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: '11px',
              color: '#b9a683',
              flexShrink: 0,
              minWidth: '34px',
              textAlign: 'right',
            }}
          >
            {formatProbability(probability)}
          </span>
        )}
      </div>

      {onMoveTo && (
        <button
          type="button"
          data-testid="move-track"
          onClick={(e) => {
            e.stopPropagation()
            onMoveTo(kind === 'sfx' ? 'music' : 'sfx')
          }}
          title={kind === 'sfx' ? 'Move to the music library' : 'Move to the effects library'}
          className="absolute top-0 right-1 opacity-0 group-hover:opacity-70 group-focus-within:opacity-70 focus-visible:opacity-100 hover:opacity-100 transition-opacity"
          style={{ fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", color: '#a5813f' }}
        >
          {kind === 'sfx' ? '→ music' : '→ fx'}
        </button>
      )}

      {/* Hover overlay toolbar — appears on top of the right side */}
      <div
        className="absolute inset-y-0 right-0 flex items-center gap-1 px-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity"
        style={{
          background: 'linear-gradient(to right, transparent, #0a0907 24px)',
          paddingLeft: '28px',
          zIndex: 1,
        }}
      >
        {/* Tag pills */}
        {tags.length > 0 && !editingTags && (
          <div className="flex items-center gap-1 shrink-0 overflow-hidden">
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-1.5 truncate"
                style={{
                  background: 'rgba(200,146,42,0.12)',
                  border: '1px solid rgba(200,146,42,0.25)',
                  fontSize: '11px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: '#d9a441',
                  lineHeight: '16px',
                  maxWidth: '80px',
                }}
              >
                {tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span style={{ fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", color: '#a5813f' }}>
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}

        {showReorder && (
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className="p-1"
              style={{ opacity: canMoveUp ? 1 : 0.3 }}
            >
              <ChevronUp />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown}
              className="p-1"
              style={{ opacity: canMoveDown ? 1 : 0.3 }}
            >
              <ChevronDown />
            </button>
          </div>
        )}

        {meta && (
          <div className="relative" onMouseEnter={() => setExpanded(true)} onMouseLeave={() => setExpanded(false)}>
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
              title="Track details"
              style={{ color: expanded ? '#d9a441' : undefined }}
            >
              <InfoIcon />
            </button>
            {expanded && <MetadataTooltip meta={meta} filename={filename} anchorRef={cardRef} />}
          </div>
        )}

        {onTagsChange && (
          <button
            type="button"
            onClick={() => setEditingTags((e) => !e)}
            className="w-7 h-7 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
            title="Edit tags"
            style={{ color: editingTags ? '#d9a441' : undefined, fontSize: '14px' }}
          >
            <TagIcon />
          </button>
        )}

        {onPlayNext && (
          <button
            type="button"
            onClick={onPlayNext}
            className="px-1.5 py-0.5 hover:opacity-80 transition-opacity"
            title="Play next"
            style={{
              fontSize: '11px',
              fontFamily: "'IBM Plex Mono', monospace",
              color: '#a5813f',
              border: '1px solid rgba(200,146,42,0.2)',
              lineHeight: '14px',
            }}
          >
            NEXT
          </button>
        )}
        {onAddToQueue && (
          <button
            type="button"
            onClick={onAddToQueue}
            className="px-1.5 py-0.5 hover:opacity-80 transition-opacity"
            title="Add to queue"
            style={{
              fontSize: '11px',
              fontFamily: "'IBM Plex Mono', monospace",
              color: '#a5813f',
              border: '1px solid rgba(200,146,42,0.2)',
              lineHeight: '14px',
            }}
          >
            QUEUE
          </button>
        )}

        <button
          type="button"
          onClick={onPin}
          className="w-7 h-7 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
          title={isPinned ? 'Unpin' : 'Pin'}
        >
          <PinIcon filled={isPinned} />
        </button>
      </div>

      {/* Inline tag editor */}
      {editingTags && onTagsChange && (
        <div className="px-3 pb-2 pt-1" style={{ borderTop: '1px solid rgba(46,36,22,0.3)' }}>
          <TagInput tags={tags} allTags={allTags} onChange={onTagsChange} />
        </div>
      )}
    </div>
  )
}
