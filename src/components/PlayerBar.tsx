import { useRef, useState } from 'react'
import { formatTime } from '../lib/formatTime'
import type { LoopMode } from '../types'
import {
  LoopIcon,
  LoopOneIcon,
  MusicNoteIcon,
  PauseIcon,
  PlayIcon,
  QueueIcon,
  SkipNextIcon,
  SkipPrevIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeMutedIcon,
} from './Icons'
import VolumePopover from './VolumePopover'

/** Strip extension and path from a filename. */
export function trackName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/.*[/\\]/, '')
}

interface Props {
  filename: string
  isPlaying: boolean
  progress: number
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  loopMode: LoopMode
  /** Queue position: [currentIndex (0-based), total]. Omit or null if no queue. */
  queuePosition?: [number, number] | null
  onToggle: () => void
  onSeek: (pct: number) => void
  onSeekStart: () => void
  onSeekEnd: () => void
  onVolumeChange: (v: number) => void
  onToggleMute: () => void
  onCycleLoop: () => void
  onSkipNext?: () => void
  onSkipPrev?: () => void
  onToggleQueue?: () => void
}

export default function PlayerBar({
  filename,
  isPlaying,
  progress,
  currentTime,
  duration,
  volume,
  muted,
  loopMode,
  queuePosition,
  onToggle,
  onSeek,
  onSeekStart,
  onSeekEnd,
  onVolumeChange,
  onToggleMute,
  onCycleLoop,
  onSkipNext,
  onSkipPrev,
  onToggleQueue,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [showTrackInfo, setShowTrackInfo] = useState(false)

  const lastPointerXRef = useRef(0)

  function seekFromEvent(e: React.PointerEvent | PointerEvent) {
    if (!barRef.current) return
    const rect = barRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    lastPointerXRef.current = e.clientX
    onSeek(pct)
  }

  function handleSeekKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      onSeek(Math.min(1, progress + 5 / (duration || 1)))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onSeek(Math.max(0, progress - 5 / (duration || 1)))
    }
  }

  const VolumeIcon = muted || volume === 0 ? VolumeMutedIcon : volume < 0.5 ? VolumeLowIcon : VolumeHighIcon

  const loopColor = loopMode === 'off' ? '#3a2e1a' : '#c8922a'
  const loopTitle =
    loopMode === 'off'
      ? 'Loop off — playback stops at end'
      : loopMode === 'single'
        ? 'Looping track — current track repeats'
        : 'Looping queue — restarts from first track'

  return (
    <div
      className="shrink-0 flex flex-col px-3 py-2"
      style={{
        background: 'linear-gradient(135deg, rgba(200,146,42,0.08), rgba(107,78,21,0.04))',
        borderTop: '1px solid rgba(200,146,42,0.3)',
      }}
    >
      {/* Seek bar row */}
      <div
        ref={barRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        tabIndex={0}
        onKeyDown={handleSeekKeyDown}
        onPointerDown={(e) => {
          draggingRef.current = true
          onSeekStart()
          seekFromEvent(e)
          barRef.current?.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return
          // Ignore synthetic pointermove events with clientX: 0 from setPointerCapture
          if (e.clientX === 0 && e.clientY === 0) return
          seekFromEvent(e)
        }}
        onPointerUp={() => {
          draggingRef.current = false
          onSeekEnd()
        }}
        className="h-3 cursor-pointer flex items-center mb-1.5"
        style={{ touchAction: 'none' }}
      >
        <div className="w-full h-1 relative rounded-full" style={{ background: 'rgba(200,146,42,0.15)' }}>
          {/* Progress fill */}
          <div
            className="h-full rounded-full"
            style={{
              width: `${progress * 100}%`,
              background: 'linear-gradient(to right, #6b4e15, #c8922a)',
            }}
          />
          {/* Seek thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full"
            style={{
              left: `${progress * 100}%`,
              transform: `translate(-50%, -50%)`,
              background: '#c8922a',
              boxShadow: '0 0 4px rgba(200,146,42,0.5)',
            }}
          />
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-2">
        {/* Skip prev */}
        {onSkipPrev && (
          <button
            onClick={onSkipPrev}
            title="Previous track (P)"
            className="w-6 h-6 flex items-center justify-center shrink-0 hover:opacity-80"
            style={{ color: '#6b4e15' }}
          >
            <SkipPrevIcon />
          </button>
        )}

        {/* Play/Pause */}
        <button
          onClick={onToggle}
          className="w-7 h-7 flex items-center justify-center shrink-0"
          style={{
            border: '1px solid rgba(200,146,42,0.4)',
            background: 'rgba(200,146,42,0.08)',
          }}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        {/* Skip next */}
        {onSkipNext && (
          <button
            onClick={onSkipNext}
            title="Next track (N)"
            className="w-6 h-6 flex items-center justify-center shrink-0 hover:opacity-80"
            style={{ color: '#6b4e15' }}
          >
            <SkipNextIcon />
          </button>
        )}

        {/* Track info tooltip */}
        <div className="flex-1 min-w-0 flex items-center">
          <div
            className="relative flex items-center"
            onMouseEnter={() => setShowTrackInfo(true)}
            onMouseLeave={() => setShowTrackInfo(false)}
          >
            <button
              className="w-6 h-6 flex items-center justify-center hover:opacity-80"
              style={{ color: '#c8922a' }}
              aria-label="Track info"
            >
              <MusicNoteIcon />
            </button>
            {showTrackInfo && (
              <div className="absolute bottom-full left-0 pb-1" style={{ zIndex: 50 }}>
                <div
                  className="px-3 py-2 whitespace-nowrap"
                  style={{
                    background: 'rgba(15,13,9,0.95)',
                    border: '1px solid rgba(200,146,42,0.3)',
                    borderRadius: '4px',
                    minWidth: '160px',
                  }}
                >
                  <div
                    style={{
                      fontFamily: "'Crimson Text', serif",
                      fontSize: '13px',
                      color: '#e8d5a3',
                      lineHeight: '1.4',
                      marginBottom: '2px',
                    }}
                  >
                    {trackName(filename)}
                  </div>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      color: '#6b4e15',
                    }}
                  >
                    {formatTime(currentTime)}
                    {duration > 0 ? ` / ${formatTime(duration)}` : ''}
                    {queuePosition && queuePosition[1] > 0 && (
                      <span style={{ marginLeft: '8px', color: '#3a2e1a' }}>
                        {queuePosition[0] + 1}/{queuePosition[1]}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Loop toggle */}
        <button
          onClick={onCycleLoop}
          title={loopTitle}
          className="w-6 h-6 flex items-center justify-center shrink-0 hover:opacity-80"
          style={{ color: loopColor }}
        >
          {loopMode === 'single' ? <LoopOneIcon /> : <LoopIcon />}
        </button>

        {/* Queue toggle */}
        {onToggleQueue && (
          <button
            onClick={onToggleQueue}
            title="Queue"
            className="w-6 h-6 flex items-center justify-center shrink-0 hover:opacity-80"
            style={{ color: queuePosition && queuePosition[1] > 0 ? '#c8922a' : '#3a2e1a' }}
          >
            <QueueIcon />
          </button>
        )}

        {/* Volume */}
        <VolumePopover
          volume={volume}
          onVolumeChange={onVolumeChange}
          onToggleMute={onToggleMute}
          muted={muted}
          VolumeIcon={VolumeIcon}
        />

        {/* Playing indicator */}
        {isPlaying && (
          <div className="flex items-end gap-px shrink-0" style={{ height: '12px' }}>
            {[0.4, 0.7, 1, 0.6, 0.8].map((h, i) => (
              <div
                key={i}
                className="w-px rounded-full animate-bounce"
                style={{
                  height: `${h * 100}%`,
                  background: '#c8922a',
                  opacity: 0.7,
                  animationDelay: `${i * 0.08}s`,
                  animationDuration: '0.6s',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
