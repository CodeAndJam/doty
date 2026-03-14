import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { formatTime } from '../lib/formatTime'
import type { SfxMeta } from '../types'
import { SFX_CATEGORY_LABELS, type SfxCategory } from '../types'
import { InfoIcon, LoopSmallIcon, PinIcon, PlayIcon, StopIcon, TagIcon } from './Icons'
import TagInput from './TagInput'

// ── Helpers ──────────────────────────────────────────────────────────────────

function MetaRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === '') return null
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span style={{ color: '#3a6b52', fontSize: '11px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ color: '#8a7050', fontSize: '11px', fontFamily: "'Crimson Text', serif", textAlign: 'right' }}>
        {value}
      </span>
    </div>
  )
}

function SfxMetadataTooltip({
  sfx,
  tags,
  anchorRef,
}: {
  sfx: SfxMeta
  tags: string[]
  anchorRef: React.RefObject<HTMLDivElement | null>
}) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    if (!anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setPos({ top: rect.top, left: rect.left, width: Math.max(rect.width, 220) })
  }, [anchorRef])

  if (!pos) return null

  const categoryLabel = SFX_CATEGORY_LABELS[sfx.category as SfxCategory] ?? sfx.category

  return ReactDOM.createPortal(
    <div
      className="fixed px-3 py-2"
      style={{
        zIndex: 9999,
        top: Math.max(8, pos.top - 8),
        left: pos.left,
        width: pos.width,
        transform: 'translateY(-100%)',
        background: '#0f0d09',
        border: '1px solid rgba(74,138,106,0.3)',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.8), 0 4px 20px rgba(0,0,0,0.6)',
      }}
    >
      <div className="grid grid-cols-1 gap-y-0">
        <MetaRow label="Category" value={categoryLabel} />
        {sfx.description && <MetaRow label="Desc" value={sfx.description} />}
        <MetaRow label="Duration" value={sfx.duration ? formatTime(sfx.duration) : null} />
        <MetaRow label="Source" value={sfx.source === 'builtin' ? 'Built-in' : 'Custom'} />
        <MetaRow label="File" value={sfx.filename.split('/').pop() ?? sfx.filename} />
        {tags.length > 0 && <MetaRow label="Tags" value={tags.join(', ')} />}
        {sfx.attribution && (
          <>
            <MetaRow label="Author" value={sfx.attribution.author} />
            <MetaRow label="License" value={sfx.attribution.license} />
            {sfx.attribution.sourceUrl && <MetaRow label="URL" value={sfx.attribution.sourceUrl} />}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

interface SfxCardProps {
  sfx: SfxMeta
  /** Channel id if currently playing, null otherwise */
  channelId: string | null
  isPlaying: boolean
  isLooping: boolean
  isPinned: boolean
  channelVolume: number
  tags: string[]
  allTags: string[]
  onPlay: (loop?: boolean) => void
  onStop: () => void
  onToggleLoop: () => void
  onVolumeChange: (v: number) => void
  onPin: () => void
  onTagsChange: (tags: string[]) => void
}

export default function SfxCard({
  sfx,
  channelId: _channelId,
  isPlaying,
  isLooping,
  isPinned,
  channelVolume,
  tags,
  allTags,
  onPlay,
  onStop,
  onToggleLoop,
  onVolumeChange,
  onPin,
  onTagsChange,
}: SfxCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [editingTags, setEditingTags] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={cardRef}
      className="relative group transition-all"
      style={{
        background: isPlaying
          ? 'linear-gradient(135deg, rgba(74,138,106,0.12), rgba(74,138,106,0.04))'
          : 'linear-gradient(160deg, #0f0d09, #080705)',
        border: `1px solid ${isPinned ? 'rgba(74,138,106,0.4)' : isPlaying ? 'rgba(74,138,106,0.4)' : '#2e2416'}`,
        boxShadow: isPlaying
          ? '0 0 12px rgba(74,138,106,0.15), inset 0 1px 0 rgba(74,138,106,0.06)'
          : 'inset 0 1px 0 rgba(255,255,255,0.02)',
        padding: '8px 10px',
      }}
    >
      <div className="flex items-center gap-2">
        {/* Play / Stop button */}
        <button
          onClick={() => (isPlaying ? onStop() : onPlay())}
          className="w-7 h-7 flex items-center justify-center shrink-0"
          style={{
            border: `1px solid ${isPlaying ? 'rgba(74,138,106,0.5)' : '#2e2416'}`,
            background: isPlaying ? 'rgba(74,138,106,0.1)' : 'transparent',
            borderRadius: '4px',
            color: isPlaying ? '#4a8a6a' : '#6b4e15',
          }}
          title={isPlaying ? 'Stop' : 'Play'}
        >
          {isPlaying ? <StopIcon /> : <PlayIcon />}
        </button>

        {/* Label */}
        <span
          className="flex-1 min-w-0 truncate"
          style={{
            fontFamily: "'Crimson Text', serif",
            fontSize: '14px',
            color: isPlaying ? '#a8d5b8' : '#8a7050',
          }}
        >
          {sfx.label}
        </span>

        {/* Tag pills (read-only display) */}
        {tags.length > 0 && !editingTags && (
          <div className="flex items-center gap-0.5 shrink-0 max-w-[30%] overflow-hidden">
            {tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="px-1 truncate"
                style={{
                  background: 'rgba(74,138,106,0.12)',
                  border: '1px solid rgba(74,138,106,0.25)',
                  fontSize: '9px',
                  fontFamily: 'monospace',
                  color: '#4a8a6a',
                  lineHeight: '14px',
                  maxWidth: '60px',
                }}
              >
                {tag}
              </span>
            ))}
            {tags.length > 2 && (
              <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3a2e1a' }}>+{tags.length - 2}</span>
            )}
          </div>
        )}

        {/* Loop toggle — visible when playing or on hover */}
        <button
          onClick={() => (isPlaying ? onToggleLoop() : onPlay(true))}
          className={`w-6 h-6 flex items-center justify-center shrink-0 transition-opacity ${
            isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
          }`}
          title={isLooping ? 'Stop looping' : 'Loop'}
          style={{ color: isLooping ? '#4a8a6a' : '#3a2e1a' }}
        >
          <LoopSmallIcon />
        </button>

        {/* Per-channel volume — only when playing */}
        {isPlaying && (
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(channelVolume * 100)}
            onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
            className="w-14 shrink-0"
            style={{ accentColor: '#4a8a6a', height: '2px' }}
            aria-label={`${sfx.label} volume`}
          />
        )}

        {/* Tag edit toggle */}
        <button
          onClick={() => setEditingTags((e) => !e)}
          className="w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0"
          title="Edit tags"
          style={{ color: editingTags ? '#4a8a6a' : '#3a2e1a' }}
        >
          <TagIcon />
        </button>

        {/* Pin button */}
        <button
          onClick={onPin}
          className="w-5 h-5 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity shrink-0"
          title={isPinned ? 'Unpin' : 'Pin'}
        >
          <PinIcon filled={isPinned} />
        </button>

        {/* Info tooltip toggle */}
        <div className="relative" onMouseEnter={() => setExpanded(true)} onMouseLeave={() => setExpanded(false)}>
          <button
            className="w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
            title="Effect details"
            style={{ color: expanded ? '#4a8a6a' : '#3a2e1a' }}
          >
            <InfoIcon />
          </button>
          {expanded && <SfxMetadataTooltip sfx={sfx} tags={tags} anchorRef={cardRef} />}
        </div>
      </div>

      {/* Category badge */}
      <span
        className="absolute top-1 right-1.5"
        style={{
          fontFamily: 'monospace',
          fontSize: '9px',
          color: isPlaying ? 'rgba(74,138,106,0.4)' : '#2e2416',
          pointerEvents: 'none',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {sfx.category}
      </span>

      {/* Inline tag editor */}
      {editingTags && (
        <div className="mt-1.5 pt-1.5" style={{ borderTop: '1px solid rgba(46,36,22,0.3)' }}>
          <TagInput tags={tags} allTags={allTags} onChange={onTagsChange} />
        </div>
      )}
    </div>
  )
}
