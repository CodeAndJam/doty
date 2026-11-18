import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { formatTime } from '../lib/formatTime'
import type { SfxMeta } from '../types'
import { SFX_CATEGORY_LABELS, type SfxCategory } from '../types'
import {
  InfoIcon,
  LoopSmallIcon,
  PinIcon,
  PlayIcon,
  StopIcon,
  TagIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeMutedIcon,
} from './Icons'
import TagInput from './TagInput'
import VolumePopover from './VolumePopover'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract directory path from a filename (everything before the last separator). */
function dirName(filename: string): string {
  const idx = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'))
  return idx > 0 ? filename.substring(0, idx) : ''
}

function MetaRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === '') return null
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span
        style={{ color: '#6dbf95', fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", whiteSpace: 'nowrap' }}
      >
        {label}
      </span>
      <span style={{ color: '#b9a683', fontSize: '11px', fontFamily: "'Crimson Text', serif", textAlign: 'right' }}>
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
  const [pos, setPos] = useState<{ top: number; left: number; width: number; bottom: number } | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [flipBelow, setFlipBelow] = useState(false)

  useEffect(() => {
    if (!anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setPos({ top: rect.top, left: rect.left, width: Math.max(rect.width, 220), bottom: rect.bottom })
  }, [anchorRef])

  // After first render, check if tooltip overflows above viewport and flip below if needed
  useEffect(() => {
    if (!tooltipRef.current || !pos) return
    const tooltipHeight = tooltipRef.current.getBoundingClientRect().height
    if (pos.top - tooltipHeight - 8 < 8) {
      setFlipBelow(true)
    }
  }, [pos])

  if (!pos) return null

  const categoryLabel = SFX_CATEGORY_LABELS[sfx.category as SfxCategory] ?? sfx.category

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
        border: '1px solid rgba(74,138,106,0.3)',
        boxShadow: flipBelow
          ? '0 4px 20px rgba(0,0,0,0.8), 0 -4px 20px rgba(0,0,0,0.6)'
          : '0 -4px 20px rgba(0,0,0,0.8), 0 4px 20px rgba(0,0,0,0.6)',
      }}
    >
      <div className="grid grid-cols-1 gap-y-0">
        <MetaRow label="Category" value={categoryLabel} />
        {sfx.description && <MetaRow label="Desc" value={sfx.description} />}
        <MetaRow label="Duration" value={sfx.duration ? formatTime(sfx.duration) : null} />
        <MetaRow label="Source" value={sfx.source === 'builtin' ? 'Built-in' : 'Custom'} />
        <MetaRow label="Dir" value={dirName(sfx.filename)} />
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
  /** Rendered where the category label sits; used by the browser for the lane switch. */
  badge?: React.ReactNode
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
  badge,
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

  const VolumeIcon = channelVolume === 0 ? VolumeMutedIcon : channelVolume < 0.5 ? VolumeLowIcon : VolumeHighIcon

  return (
    <div
      ref={cardRef}
      data-testid="sfx-card"
      className="relative group transition-all"
      style={{
        background: isPlaying
          ? 'linear-gradient(135deg, rgba(74,138,106,0.12), rgba(74,138,106,0.04))'
          : 'linear-gradient(160deg, #100e0a, #080705)',
        border: `1px solid ${isPinned ? 'rgba(74,138,106,0.4)' : isPlaying ? 'rgba(74,138,106,0.4)' : '#3d2f1c'}`,
        boxShadow: isPlaying
          ? '0 0 12px rgba(74,138,106,0.15), inset 0 1px 0 rgba(74,138,106,0.06)'
          : 'inset 0 1px 0 rgba(255,255,255,0.02)',
        padding: '8px 10px',
        overflow: editingTags ? 'visible' : 'hidden',
      }}
    >
      <div className="flex items-center gap-2">
        {/* Play / Stop button */}
        <button
          type="button"
          onClick={() => (isPlaying ? onStop() : onPlay())}
          className="w-8 h-8 flex items-center justify-center shrink-0"
          style={{
            border: `1px solid ${isPlaying ? 'rgba(109,191,149,0.5)' : '#7a6138'}`,
            background: isPlaying ? 'rgba(109,191,149,0.1)' : 'transparent',
            borderRadius: '3px',
            color: isPlaying ? '#6dbf95' : '#a5813f',
          }}
          title={isPlaying ? 'Stop' : 'Play'}
          aria-label={`${isPlaying ? 'Stop' : 'Play'} ${sfx.label}`}
        >
          {isPlaying ? <StopIcon /> : <PlayIcon />}
        </button>

        {/* Label — full width */}
        <span
          className="flex-1 min-w-0"
          style={{
            fontFamily: "'Crimson Text', serif",
            fontSize: '15px',
            color: isPlaying ? '#a8d5b8' : '#e4d6b4',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={sfx.label}
        >
          {sfx.label}
        </span>
      </div>

      {/* Hover overlay toolbar */}
      <div
        className="absolute inset-y-0 right-0 flex items-center gap-1 px-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity"
        style={{
          background: 'linear-gradient(to right, transparent, #0a0907 20px)',
          paddingLeft: '24px',
        }}
      >
        {/* Tag pills */}
        {tags.length > 0 && !editingTags && (
          <div className="flex items-center gap-0.5 shrink-0 overflow-hidden">
            {tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="px-1 truncate"
                style={{
                  background: 'rgba(74,138,106,0.12)',
                  border: '1px solid rgba(74,138,106,0.25)',
                  fontSize: '11px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: '#6dbf95',
                  lineHeight: '14px',
                  maxWidth: '60px',
                }}
              >
                {tag}
              </span>
            ))}
            {tags.length > 2 && (
              <span style={{ fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", color: '#9d8b66' }}>
                +{tags.length - 2}
              </span>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => (isPlaying ? onToggleLoop() : onPlay(true))}
          className="w-5 h-5 flex items-center justify-center shrink-0 opacity-60 hover:opacity-100 transition-opacity"
          title={isLooping ? 'Stop looping' : 'Loop'}
          style={{ color: isLooping ? '#6dbf95' : '#9d8b66' }}
        >
          <LoopSmallIcon />
        </button>

        <VolumePopover
          volume={channelVolume}
          onVolumeChange={onVolumeChange}
          VolumeIcon={VolumeIcon}
          accentColor="rgba(74,138,106,0.3)"
          label={`${sfx.label} volume`}
        />

        <button
          type="button"
          onClick={() => setEditingTags((e) => !e)}
          className="w-5 h-5 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity shrink-0"
          title="Edit tags"
          style={{ color: editingTags ? '#6dbf95' : '#9d8b66' }}
        >
          <TagIcon />
        </button>

        <button
          type="button"
          onClick={onPin}
          className="w-5 h-5 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity shrink-0"
          title={isPinned ? 'Unpin' : 'Pin'}
        >
          <PinIcon filled={isPinned} />
        </button>

        <div className="relative" onMouseEnter={() => setExpanded(true)} onMouseLeave={() => setExpanded(false)}>
          <button
            type="button"
            className="w-5 h-5 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
            title="Effect details"
            style={{ color: expanded ? '#6dbf95' : '#9d8b66' }}
          >
            <InfoIcon />
          </button>
          {expanded && <SfxMetadataTooltip sfx={sfx} tags={tags} anchorRef={cardRef} />}
        </div>
      </div>

      {/* Category badge, or the lane badge the browser passes in its place.
          A file pulled in from the music folder has no useful category, so it
          gets no badge at all. */}
      {badge ??
        (SFX_CATEGORY_LABELS[sfx.category as SfxCategory] ? (
          <span
            className="absolute top-1 right-1.5 group-hover:opacity-0 transition-opacity"
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: '11px',
              color: isPlaying ? 'rgba(74,138,106,0.4)' : '#3d2f1c',
              pointerEvents: 'none',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {SFX_CATEGORY_LABELS[sfx.category as SfxCategory]}
          </span>
        ) : null)}

      {/* Inline tag editor */}
      {editingTags && (
        <div className="mt-1.5 pt-1.5" style={{ borderTop: '1px solid rgba(46,36,22,0.3)' }}>
          <TagInput tags={tags} allTags={allTags} onChange={onTagsChange} />
        </div>
      )}
    </div>
  )
}
