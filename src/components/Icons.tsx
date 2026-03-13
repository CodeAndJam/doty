/** Shared SVG icon components used across the UI. */

export function PlayIcon() {
  return <svg className="w-4 h-4" fill="#6b4e15" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
}

export function PauseIcon() {
  return <svg className="w-4 h-4" fill="#c8922a" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
}

export function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill={filled ? '#c8922a' : 'none'} stroke={filled ? '#c8922a' : '#6b4e15'} strokeWidth="2">
      <path d="M12 2l2.09 6.26L21 9.27l-5 4.87L17.18 21 12 17.27 6.82 21 8 14.14l-5-4.87 6.91-1.01z" />
    </svg>
  )
}

export function ChevronUp() {
  return <svg className="w-4 h-4" fill="#6b4e15" viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" /></svg>
}

export function ChevronDown() {
  return <svg className="w-4 h-4" fill="#6b4e15" viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" /></svg>
}

export function BrowseIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="#6b4e15" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
}

export function CloseIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="#6b4e15" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
}

export function SearchIcon() {
  return <svg className="w-3.5 h-3.5" fill="none" stroke="#6b4e15" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
}

export function InfoIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="#6b4e15" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
}

export function GearIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 15.5A3.5 3.5 0 018.5 12 3.5 3.5 0 0112 8.5a3.5 3.5 0 013.5 3.5 3.5 3.5 0 01-3.5 3.5m7.43-2.92c.04-.34.07-.68.07-1.08s-.03-.74-.07-1.08l2.32-1.82c.21-.16.27-.46.13-.7l-2.2-3.82c-.13-.24-.42-.32-.66-.24l-2.74 1.1c-.57-.44-1.18-.8-1.86-1.08L14.5 2.42c-.04-.26-.27-.42-.5-.42h-4c-.23 0-.46.16-.5.42L9.13 5.36C8.45 5.64 7.84 6 7.27 6.44L4.53 5.34c-.24-.08-.53 0-.66.24L1.67 9.4c-.14.24-.08.54.13.7l2.32 1.82c-.04.34-.07.69-.07 1.08s.03.74.07 1.08L1.8 15.9c-.21.16-.27.46-.13.7l2.2 3.82c.13.24.42.32.66.24l2.74-1.1c.57.44 1.18.8 1.86 1.08l.37 2.94c.04.26.27.42.5.42h4c.23 0 .46-.16.5-.42l.37-2.94c.68-.28 1.29-.64 1.86-1.08l2.74 1.1c.24.08.53 0 .66-.24l2.2-3.82c.14-.24.08-.54-.13-.7l-2.32-1.82z" />
    </svg>
  )
}

export function VolumeHighIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="#c8922a" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
    </svg>
  )
}

export function VolumeLowIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="#c8922a" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 010 7.07" />
    </svg>
  )
}

export function VolumeMutedIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="#6b4e15" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M23 9l-6 6M17 9l6 6" />
    </svg>
  )
}

export function LoopIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 014-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 01-4 4H3" />
    </svg>
  )
}

export function LoopOneIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 014-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 01-4 4H3" />
      <text x="12" y="15" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8" fontWeight="bold">1</text>
    </svg>
  )
}

export function SkipNextIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z" />
    </svg>
  )
}

export function SkipPrevIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
    </svg>
  )
}

export function QueueIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 6h16M4 10h16M4 14h10M15 18l3-3 3 3M18 15v6" />
    </svg>
  )
}

export function DragHandleIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
      <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
    </svg>
  )
}

export function EyeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}

export function EyeOffIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M13.875 18.825A10.05 10.05 0 0112 19c-5 0-9.27-3.11-11-7.5a11.72 11.72 0 013.168-4.477M6.343 6.343A9.97 9.97 0 0112 5c5 0 9.27 3.11 11 7.5a11.7 11.7 0 01-4.168 4.477M6.343 6.343L3 3m3.343 3.343l2.829 2.829m4.486 4.486l2.829 2.829M6.343 6.343l11.314 11.314" />
    </svg>
  )
}

export function TagIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <circle cx="7" cy="7" r="1" fill="currentColor" />
    </svg>
  )
}

export function MusicNoteIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" />
    </svg>
  )
}
