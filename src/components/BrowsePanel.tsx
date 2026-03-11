import { useState, useEffect } from 'react'
import { PlayIcon, PauseIcon, PinIcon, SearchIcon, CloseIcon } from './Icons'
import { trackName } from './PlayerBar'

interface BrowsePanelProps {
  pinned: string[]
  playing: string | null
  onPlay: (f: string) => void
  onPin: (f: string) => void
  onClose: () => void
}

export default function BrowsePanel({ pinned, playing, onPlay, onPin, onClose }: BrowsePanelProps) {
  const [allFiles, setAllFiles] = useState<string[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    window.doty.listMusic().then(setAllFiles)
  }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean)
  const filtered = tokens.length === 0
    ? allFiles
    : allFiles.filter(f => {
        const lower = f.toLowerCase()
        return tokens.every(t => lower.includes(t))
      })

  return (
    <div className="absolute inset-0 z-10 flex flex-col" style={{
      background: '#080705',
      border: '1px solid #2e2416',
    }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid #2e2416' }}>
        <SearchIcon />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tracks..."
          autoFocus
          className="flex-1 bg-transparent outline-none text-sm"
          style={{
            fontFamily: "'Crimson Text', serif",
            fontSize: '14px',
            color: '#c8922a',
          }}
        />
        <span style={{ fontSize: '12px', color: '#3a2e1a', fontFamily: 'monospace' }}>
          {filtered.length}
        </span>
        <button onClick={(e) => { e.stopPropagation(); onClose() }} className="p-2 hover:opacity-80" style={{ cursor: 'pointer' }}>
          <CloseIcon />
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map(f => {
          const isPinned = pinned.includes(f)
          const isPlaying = playing === f
          return (
            <div
              key={f}
              className="flex items-center gap-2 px-3 py-1.5 group"
              style={{
                borderBottom: '1px solid rgba(46,36,22,0.3)',
                background: isPlaying ? 'rgba(200,146,42,0.06)' : 'transparent',
              }}
            >
              <button onClick={() => onPlay(f)} className="w-5 h-5 flex items-center justify-center shrink-0" style={{
                border: `1px solid ${isPlaying ? 'rgba(200,146,42,0.4)' : '#2e2416'}`,
              }}>
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
              <span className="flex-1 min-w-0 truncate" style={{
                fontFamily: "'Crimson Text', serif",
                fontSize: '14px',
                color: isPlaying ? '#e8d5a3' : '#8a7050',
              }}>
                {trackName(f)}
              </span>
              <button
                onClick={() => onPin(f)}
                className="p-0.5 opacity-50 hover:opacity-100 transition-opacity"
                title={isPinned ? 'Unpin' : 'Pin'}
              >
                <PinIcon filled={isPinned} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
