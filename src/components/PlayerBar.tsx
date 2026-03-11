import { useRef } from 'react'
import { PlayIcon, PauseIcon } from './Icons'

/** Strip extension and path from a filename. */
export function trackName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/.*[/\\]/, '')
}

interface Props {
  filename: string
  isPlaying: boolean
  progress: number
  onToggle: () => void
  onSeek: (pct: number) => void
}

export default function PlayerBar({ filename, isPlaying, progress, onToggle, onSeek }: Props) {
  const barRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  function seekFromEvent(e: MouseEvent | React.MouseEvent) {
    if (!barRef.current) return
    const rect = barRef.current.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
  }

  return (
    <div className="shrink-0 flex items-center gap-3 px-3 py-2" style={{
      background: 'linear-gradient(135deg, rgba(200,146,42,0.08), rgba(107,78,21,0.04))',
      borderTop: '1px solid rgba(200,146,42,0.3)',
    }}>
      <button onClick={onToggle} className="w-8 h-8 flex items-center justify-center shrink-0" style={{
        border: '1px solid rgba(200,146,42,0.4)',
        background: 'rgba(200,146,42,0.08)',
      }}>
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div className="flex-1 min-w-0">
        <span className="block truncate" style={{
          fontFamily: "'Crimson Text', serif",
          fontSize: '14px',
          color: '#e8d5a3',
          lineHeight: '1.3',
        }}>
          {trackName(filename)}
        </span>
        <div
          ref={barRef}
          onPointerDown={(e) => {
            draggingRef.current = true
            barRef.current?.setPointerCapture(e.pointerId)
            seekFromEvent(e)
          }}
          onPointerMove={(e) => { if (draggingRef.current) seekFromEvent(e) }}
          onPointerUp={() => { draggingRef.current = false }}
          className="mt-1 h-3 cursor-pointer flex items-center"
          style={{ touchAction: 'none' }}
        >
          <div className="w-full h-1 relative" style={{ background: 'rgba(200,146,42,0.15)' }}>
            <div className="h-full" style={{
              width: `${progress * 100}%`,
              background: 'linear-gradient(to right, #6b4e15, #c8922a)',
            }} />
          </div>
        </div>
      </div>

      {isPlaying && (
        <div className="flex items-end gap-px shrink-0" style={{ height: '14px' }}>
          {[0.4, 0.7, 1, 0.6, 0.8, 0.5, 0.9].map((h, i) => (
            <div key={i} className="w-px rounded-full animate-bounce" style={{
              height: `${h * 100}%`, background: '#c8922a', opacity: 0.7,
              animationDelay: `${i * 0.08}s`, animationDuration: '0.6s',
            }} />
          ))}
        </div>
      )}
    </div>
  )
}
