import { type ReactNode, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { formatProbability } from '../lib/confidence'
import { formatTime } from '../lib/formatTime'
import type { SfxMeta, TrackMeta } from '../types'
import { SFX_CATEGORY_LABELS, type SfxCategory } from '../types'
import { InfoIcon, PauseIcon, PinIcon, PlayIcon, StopIcon, TagIcon } from './Icons'
import TagInput from './TagInput'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract directory path from a filename (everything before the last separator). */
function dirName(filename: string): string {
  const idx = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'))
  return idx > 0 ? filename.substring(0, idx) : ''
}

function row(label: string, value: string | number | null | undefined): Array<[string, string]> {
  return value == null || value === '' ? [] : [[label, String(value)]]
}

/** Everything the tooltip shows for a track. One reader, one format. */
export function musicDetails(filename: string, meta?: TrackMeta): Array<[string, string]> {
  const rows: Array<[string, string]> = [...row('Dir', dirName(filename))]
  if (!meta) return rows
  return rows.concat(
    row('BPM', meta.bpm ? `${Math.round(meta.bpm)} (${Math.round(meta.bpmConfidence * 100)}%)` : null),
    row('Key', meta.key && meta.scale ? `${meta.key} ${meta.scale}` : meta.key),
    row('Energy', meta.energy != null ? `${Math.round(meta.energy * 100)}%` : null),
    row('Dance', meta.danceability != null ? `${Math.round(meta.danceability * 100)}%` : null),
    row('Duration', meta.duration ? formatTime(meta.duration) : null),
    row('Artist', meta.artist),
    row('Album', meta.album),
    row('Genre', meta.genre),
    row('Year', meta.year),
    row('Codec', meta.codec),
    row('Bitrate', meta.bitrate ? `${meta.bitrate} kbps` : null),
    row('Sample', meta.sampleRate ? `${(meta.sampleRate / 1000).toFixed(1)} kHz` : null),
  )
}

/** The same for an effect: what it is, where it came from, who made it. */
export function sfxDetails(sfx: SfxMeta, tags: string[]): Array<[string, string]> {
  return [
    ...row('Category', SFX_CATEGORY_LABELS[sfx.category as SfxCategory] ?? sfx.category),
    ...row('Desc', sfx.description),
    ...row('Duration', sfx.duration ? formatTime(sfx.duration) : null),
    ...row('Source', sfx.source === 'builtin' ? 'Built-in' : 'Custom'),
    ...row('Dir', dirName(sfx.filename)),
    ...row('File', sfx.filename.split('/').pop() ?? sfx.filename),
    ...row('Tags', tags.join(', ')),
    ...row('Author', sfx.attribution?.author),
    ...row('License', sfx.attribution?.license),
    ...row('URL', sfx.attribution?.sourceUrl),
  ]
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

function DetailsTooltip({
  rows,
  accent,
  anchorRef,
}: {
  rows: Array<[string, string]>
  accent: string
  anchorRef: React.RefObject<HTMLDivElement | null>
}) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number; bottom: number } | null>(null)
  const [flipBelow, setFlipBelow] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setPos({ top: rect.top, left: rect.left, width: Math.max(rect.width, 240), bottom: rect.bottom })
  }, [anchorRef])

  // A tooltip that opens upward near the top edge would be off-screen.
  useEffect(() => {
    if (!tooltipRef.current || !pos) return
    if (pos.top - tooltipRef.current.getBoundingClientRect().height - 8 < 8) setFlipBelow(true)
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
        background: 'var(--panel)',
        border: `1px solid ${accent}`,
        boxShadow: flipBelow
          ? '0 4px 20px rgba(0,0,0,0.8), 0 -4px 20px rgba(0,0,0,0.6)'
          : '0 -4px 20px rgba(0,0,0,0.8), 0 4px 20px rgba(0,0,0,0.6)',
      }}
    >
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 py-0.5">
          <span
            style={{ color: accent, fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", whiteSpace: 'nowrap' }}
          >
            {label}
          </span>
          <span style={{ color: 'var(--ink-secondary)', fontSize: '11px', textAlign: 'right' }}>{value}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}

// ── Card ─────────────────────────────────────────────────────────────────────

/**
 * One row of a recommendation list. Music and effects share it so the two
 * columns never disagree about their shape: the play button, the title and the
 * probability sit in the same place whichever shelf the row came from. What is
 * specific to a shelf — loop, volume, reorder, moving a file — arrives as
 * `actions` and `corner` rather than as a second card.
 */
const TONES = {
  music: {
    accent: 'var(--accent)',
    pinned: 'rgba(217,164,65,0.4)',
    text: 'var(--ink-body)',
    playingText: 'var(--ink)',
    rest: 'linear-gradient(160deg, var(--panel), var(--surface))',
    playing: 'linear-gradient(135deg, rgba(217,164,65,0.14), rgba(165,129,63,0.06))',
    restShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
    playingShadow: '0 0 16px rgba(217,164,65,0.18), inset 0 1px 0 rgba(217,164,65,0.08)',
    hover: 'rgba(217,164,65,0.05)',
    playBg: 'rgba(217,164,65,0.1)',
    pillBg: 'rgba(200,146,42,0.12)',
    pillBorder: 'rgba(200,146,42,0.25)',
  },
  sfx: {
    accent: 'var(--rune)',
    pinned: 'rgba(74,138,106,0.4)',
    text: 'var(--ink-body)',
    playingText: '#a8d5b8',
    rest: 'linear-gradient(160deg, var(--panel), var(--surface))',
    playing: 'linear-gradient(135deg, rgba(74,138,106,0.12), rgba(74,138,106,0.04))',
    restShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
    playingShadow: '0 0 12px rgba(74,138,106,0.15), inset 0 1px 0 rgba(74,138,106,0.06)',
    hover: 'rgba(109,191,149,0.05)',
    playBg: 'rgba(109,191,149,0.1)',
    pillBg: 'rgba(74,138,106,0.12)',
    pillBorder: 'rgba(74,138,106,0.25)',
  },
}

interface Props {
  kind: 'music' | 'sfx'
  title: string
  isPlaying: boolean
  isPinned: boolean
  /** The model's probability that this is the right pick, when it produced one. */
  probability?: number
  /** A short marker in the top corner, e.g. the effect's category or its lane. */
  corner?: ReactNode
  /** Shelf-specific hover controls, in front of the shared ones. */
  actions?: ReactNode
  /** Tooltip rows; omitted means no info button. */
  details?: Array<[string, string]>
  tags?: string[]
  allTags?: string[]
  onPlay: () => void
  onPin: () => void
  onTagsChange?: (tags: string[]) => void
}

export default function RecommendCard({
  kind,
  title,
  isPlaying,
  isPinned,
  probability,
  corner,
  actions,
  details,
  tags = [],
  allTags = [],
  onPlay,
  onPin,
  onTagsChange,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [editingTags, setEditingTags] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const tone = TONES[kind]
  const accentLine = isPinned ? tone.pinned : isPlaying ? tone.accent : 'var(--line)'

  return (
    <div
      ref={cardRef}
      data-testid={kind === 'sfx' ? 'sfx-card' : 'track-card'}
      className="relative group transition-all"
      style={{
        minHeight: '48px',
        overflow: editingTags ? 'visible' : 'hidden',
        zIndex: editingTags ? 20 : undefined,
        background: isPlaying ? tone.playing : tone.rest,
        border: `1px solid ${accentLine}`,
        boxShadow: isPlaying ? tone.playingShadow : tone.restShadow,
      }}
    >
      {/* The whole row answers the pointer and the keyboard. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
        style={{ background: tone.hover }}
      />
      <div className="relative flex items-center gap-3 px-3 py-1.5 h-full">
        <button
          type="button"
          onClick={onPlay}
          title={isPlaying ? (kind === 'sfx' ? 'Stop' : 'Pause') : 'Play'}
          aria-label={`${isPlaying ? (kind === 'sfx' ? 'Stop' : 'Pause') : 'Play'} ${title}`}
          className="w-9 h-9 flex items-center justify-center shrink-0 transition-colors"
          style={{
            border: `1px solid ${isPlaying ? tone.accent : 'var(--line-strong)'}`,
            background: isPlaying ? tone.playBg : 'transparent',
            color: isPlaying ? tone.accent : 'var(--accent-dim)',
            borderRadius: '3px',
          }}
        >
          {isPlaying ? kind === 'sfx' ? <StopIcon /> : <PauseIcon /> : <PlayIcon />}
        </button>

        <span
          className="flex-1 min-w-0"
          style={{
            fontFamily: "'Crimson Text', Georgia, serif",
            fontSize: '17px',
            color: isPlaying ? tone.playingText : tone.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            // Keep the title clear of the corner marker rather than under it.
            paddingRight: corner ? '26px' : undefined,
          }}
          title={title}
        >
          {title}
        </span>

        {probability !== undefined && (
          <span
            data-testid={kind === 'sfx' ? 'sfx-probability' : 'track-probability'}
            title="The model's probability that this is the right pick, out of the candidates it ranked"
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: '11px',
              color: 'var(--ink-secondary)',
              flexShrink: 0,
              minWidth: '34px',
              textAlign: 'right',
            }}
          >
            {formatProbability(probability)}
          </span>
        )}
      </div>

      {/* A caller's corner marker stays clickable: the hover toolbar paints over it. */}
      {corner && <div className="absolute top-1 right-1.5">{corner}</div>}

      {/* Hover overlay toolbar — appears on top of the right side */}
      <div
        className="absolute inset-y-0 right-0 flex items-center gap-1 px-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity"
        style={{
          background: `linear-gradient(to right, transparent, var(--surface) 24px)`,
          paddingLeft: '28px',
          zIndex: 1,
        }}
      >
        {tags.length > 0 && !editingTags && (
          <div className="flex items-center gap-1 shrink-0 overflow-hidden">
            {tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="px-1.5 truncate"
                style={{
                  background: tone.pillBg,
                  border: `1px solid ${tone.pillBorder}`,
                  fontSize: '11px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: tone.accent,
                  lineHeight: '16px',
                  maxWidth: '80px',
                }}
              >
                {tag}
              </span>
            ))}
            {tags.length > 2 && (
              <span style={{ fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", color: 'var(--accent-dim)' }}>
                +{tags.length - 2}
              </span>
            )}
          </div>
        )}

        {actions}

        {details && details.length > 0 && (
          <div className="relative" onMouseEnter={() => setExpanded(true)} onMouseLeave={() => setExpanded(false)}>
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
              title="Details"
              style={{ color: expanded ? tone.accent : undefined }}
            >
              <InfoIcon />
            </button>
            {expanded && <DetailsTooltip rows={details} accent={tone.accent} anchorRef={cardRef} />}
          </div>
        )}

        {onTagsChange && (
          <button
            type="button"
            onClick={() => setEditingTags((e) => !e)}
            className="w-7 h-7 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
            title="Edit tags"
            style={{ color: editingTags ? tone.accent : undefined, fontSize: '14px' }}
          >
            <TagIcon />
          </button>
        )}

        <button
          type="button"
          onClick={onPin}
          className="w-7 h-7 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
          title={isPinned ? 'Unpin' : 'Pin'}
          style={{ color: isPinned ? tone.accent : undefined }}
        >
          <PinIcon filled={isPinned} />
        </button>
      </div>

      {editingTags && onTagsChange && (
        <div className="px-3 pb-2 pt-1" style={{ borderTop: '1px solid rgba(46,36,22,0.3)' }}>
          <TagInput tags={tags} allTags={allTags} onChange={onTagsChange} />
        </div>
      )}
    </div>
  )
}
