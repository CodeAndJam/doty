import { useEffect, useState } from 'react'
import { CloseIcon, PauseIcon, PinIcon, PlayIcon, SearchIcon, TagIcon } from './Icons'
import { trackName } from './PlayerBar'

interface BrowsePanelProps {
  pinned: string[]
  playing: string | null
  tagsMap: Record<string, string[]>
  allTags: string[]
  onPlay: (f: string) => void
  onPin: (f: string) => void
  onClose: () => void
}

export default function BrowsePanel({ pinned, playing, tagsMap, allTags, onPlay, onPin, onClose }: BrowsePanelProps) {
  const [allFiles, setAllFiles] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([])

  useEffect(() => {
    window.doty.listMusic().then(setAllFiles)
  }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  function toggleTagFilter(tag: string) {
    setActiveTagFilters((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean)
  const filtered = allFiles.filter((f) => {
    const lower = f.toLowerCase()
    const fileTags = tagsMap[f] || []

    // Text search: match filename OR tags
    const textMatch =
      tokens.length === 0 || tokens.every((t) => lower.includes(t) || fileTags.some((tag) => tag.includes(t)))

    // Tag chip filters: must have ALL active tag filters
    const tagMatch = activeTagFilters.length === 0 || activeTagFilters.every((t) => fileTags.includes(t))

    return textMatch && tagMatch
  })

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col"
      style={{
        background: '#080705',
        border: '1px solid #2e2416',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid #2e2416' }}>
        <SearchIcon />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tracks or tags..."
          className="flex-1 bg-transparent outline-none text-sm"
          style={{
            fontFamily: "'Crimson Text', serif",
            fontSize: '14px',
            color: '#c8922a',
          }}
        />
        <span style={{ fontSize: '12px', color: '#3a2e1a', fontFamily: 'monospace' }}>{filtered.length}</span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="p-2 hover:opacity-80"
          style={{ cursor: 'pointer' }}
        >
          <CloseIcon />
        </button>
      </div>

      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <div
          className="flex items-center gap-1 px-3 py-1.5 shrink-0 overflow-x-auto"
          style={{ borderBottom: '1px solid rgba(46,36,22,0.3)' }}
        >
          <TagIcon />
          {allTags.map((tag) => {
            const active = activeTagFilters.includes(tag)
            return (
              <button
                key={tag}
                onClick={() => toggleTagFilter(tag)}
                className="px-1.5 py-0 shrink-0"
                style={{
                  background: active ? 'rgba(200,146,42,0.25)' : 'rgba(200,146,42,0.08)',
                  border: `1px solid ${active ? 'rgba(200,146,42,0.5)' : 'rgba(200,146,42,0.2)'}`,
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  color: active ? '#e8d5a3' : '#8a7050',
                  lineHeight: '18px',
                  cursor: 'pointer',
                }}
              >
                {tag}
              </button>
            )
          })}
          {activeTagFilters.length > 0 && (
            <button
              onClick={() => setActiveTagFilters([])}
              className="px-1 opacity-50 hover:opacity-100"
              style={{ fontSize: '11px', fontFamily: 'monospace', color: '#6b4e15' }}
            >
              clear
            </button>
          )}
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map((f) => {
          const isPinned = pinned.includes(f)
          const isPlaying = playing === f
          const fileTags = tagsMap[f] || []
          return (
            <div
              key={f}
              className="flex items-center gap-2 px-3 py-1.5 group"
              style={{
                borderBottom: '1px solid rgba(46,36,22,0.3)',
                background: isPlaying ? 'rgba(200,146,42,0.06)' : 'transparent',
              }}
            >
              <button
                onClick={() => onPlay(f)}
                className="w-5 h-5 flex items-center justify-center shrink-0"
                style={{
                  border: `1px solid ${isPlaying ? 'rgba(200,146,42,0.4)' : '#2e2416'}`,
                }}
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
              <span
                className="flex-1 min-w-0 truncate"
                style={{
                  fontFamily: "'Crimson Text', serif",
                  fontSize: '14px',
                  color: isPlaying ? '#e8d5a3' : '#8a7050',
                }}
              >
                {trackName(f)}
              </span>
              {/* Inline tag pills */}
              {fileTags.length > 0 && (
                <div className="flex items-center gap-0.5 shrink-0">
                  {fileTags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className="px-1 truncate"
                      style={{
                        background: 'rgba(200,146,42,0.1)',
                        border: '1px solid rgba(200,146,42,0.2)',
                        fontSize: '9px',
                        fontFamily: 'monospace',
                        color: '#c8922a',
                        lineHeight: '14px',
                        maxWidth: '60px',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                  {fileTags.length > 2 && (
                    <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#6b4e15' }}>
                      +{fileTags.length - 2}
                    </span>
                  )}
                </div>
              )}
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
