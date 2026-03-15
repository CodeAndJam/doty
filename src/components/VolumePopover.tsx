import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'

interface VolumePopoverProps {
  volume: number
  onVolumeChange: (v: number) => void
  onToggleMute?: () => void
  muted?: boolean
  VolumeIcon: React.ComponentType
  /** Accent colour for the slider border. Defaults to gold (music). */
  accentColor?: string
  /** aria-label for the slider */
  label?: string
}

/**
 * Shared volume popover used by PlayerBar and SfxCard.
 * Renders the slider via a portal so it's never clipped by overflow:hidden containers.
 * A transparent bridge element connects the button to the slider so the mouse
 * can travel between them without the popover closing.
 */
export default function VolumePopover({
  volume,
  onVolumeChange,
  onToggleMute,
  muted,
  VolumeIcon,
  accentColor = 'rgba(200,146,42,0.3)',
  label = 'Volume',
}: VolumePopoverProps) {
  const [show, setShow] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!show || !btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setPos({ top: rect.top, left: rect.left + rect.width / 2 })
  }, [show])

  return (
    <div
      className="relative flex items-center shrink-0"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={onToggleMute}
        title={onToggleMute ? (muted ? 'Unmute' : 'Mute') : 'Volume'}
        className="w-6 h-6 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
      >
        <VolumeIcon />
      </button>
      {show &&
        pos &&
        ReactDOM.createPortal(
          <div
            className="fixed"
            style={{
              zIndex: 99999,
              top: pos.top,
              left: pos.left,
              transform: 'translate(-50%, -100%)',
              /* Pad the bottom so the hover zone overlaps the trigger button */
              paddingBottom: '12px',
            }}
            onMouseEnter={() => setShow(true)}
            onMouseLeave={() => setShow(false)}
          >
            <div
              className="px-2 py-3 flex flex-col items-center"
              style={{
                background: 'rgba(15,13,9,0.95)',
                border: `1px solid ${accentColor}`,
                borderRadius: '4px',
                width: '32px',
                height: '100px',
                margin: '0 auto',
              }}
            >
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(volume * 100)}
                onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
                className="volume-slider"
                style={{
                  writingMode: 'vertical-lr',
                  direction: 'rtl',
                  width: '100%',
                  height: '100%',
                  appearance: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
                aria-label={label}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
