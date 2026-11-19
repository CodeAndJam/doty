import { useRef } from 'react'
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

  const loopColor = loopMode === 'off' ? '#9d8b66' : '#d9a441'
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
        aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
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
        className="h-5 cursor-pointer flex items-center mb-1"
        style={{ touchAction: 'none' }}
      >
        <div className="w-full relative rounded-full" style={{ height: '3px', background: 'rgba(217,164,65,0.2)' }}>
          {/* Progress fill */}
          <div
            className="h-full rounded-full"
            style={{
              width: `${progress * 100}%`,
              background: 'linear-gradient(to right, #a5813f, #d9a441)',
            }}
          />
          {/* Seek thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full"
            style={{
              left: `${progress * 100}%`,
              transform: `translate(-50%, -50%)`,
              background: '#d9a441',
              boxShadow: '0 0 4px rgba(217,164,65,0.5)',
            }}
          />
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-2">
        {/* Skip prev */}
        {onSkipPrev && (
          <button
            type="button"
            onClick={onSkipPrev}
            title="Previous track (P)"
            aria-label="Previous track"
            className="w-8 h-8 flex items-center justify-center shrink-0 hover:opacity-100 opacity-90"
            style={{ color: '#a5813f' }}
          >
            <SkipPrevIcon />
          </button>
        )}

        {/* Play/Pause */}
        <button
          type="button"
          onClick={onToggle}
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="w-8 h-8 flex items-center justify-center shrink-0"
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
            type="button"
            onClick={onSkipNext}
            title="Next track (N)"
            aria-label="Next track"
            className="w-8 h-8 flex items-center justify-center shrink-0 hover:opacity-100 opacity-90"
            style={{ color: '#a5813f' }}
          >
            <SkipNextIcon />
          </button>
        )}

        {/* The face of the transport: name, time and queue position, no hover needed */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <MusicNoteIcon />
          <span
            className="min-w-0 truncate"
            style={{ fontFamily: "'Crimson Text', serif", fontSize: '15px', color: '#e4d6b4' }}
            title={trackName(filename)}
          >
            {trackName(filename)}
          </span>
          <span className="data-label tabular-nums shrink-0" style={{ color: '#9d8b66' }}>
            {formatTime(currentTime)}
            {duration > 0 ? ` / ${formatTime(duration)}` : ''}
          </span>
          {queuePosition && queuePosition[1] > 0 && (
            <span className="data-label shrink-0" style={{ color: '#9d8b66' }}>
              {queuePosition[0] + 1}/{queuePosition[1]}
            </span>
          )}
        </div>

        {/* Loop toggle */}
        <button
          type="button"
          onClick={onCycleLoop}
          title={loopTitle}
          aria-label={loopTitle}
          className="w-8 h-8 flex items-center justify-center shrink-0 hover:opacity-100 opacity-90"
          style={{ color: loopColor }}
        >
          {loopMode === 'single' ? <LoopOneIcon /> : <LoopIcon />}
        </button>

        {/* Queue toggle */}
        {onToggleQueue && (
          <button
            type="button"
            onClick={onToggleQueue}
            title="Queue"
            aria-label="Queue"
            className="w-8 h-8 flex items-center justify-center shrink-0 hover:opacity-100 opacity-90"
            style={{ color: queuePosition && queuePosition[1] > 0 ? '#d9a441' : '#9d8b66' }}
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
                  background: '#d9a441',
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
