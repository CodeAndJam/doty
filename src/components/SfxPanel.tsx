import { useEffect, useMemo, useState } from 'react'
import { useSfxPlayer } from '../hooks/useSfxPlayer'
import type { SfxCategory, SfxMeta } from '../types'
import { SFX_CATEGORY_LABELS } from '../types'
import { PinIcon, SearchIcon, StopIcon } from './Icons'
import SfxCard from './SfxCard'

const SFX_PINS_KEY = 'doty:pinnedSfx'

function loadSfxPins(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SFX_PINS_KEY) || '[]')
  } catch {
    return []
  }
}
function saveSfxPins(pins: string[]) {
  localStorage.setItem(SFX_PINS_KEY, JSON.stringify(pins))
}

interface Props {
  sfxRecommendations: string[]
}

export default function SfxPanel({ sfxRecommendations }: Props) {
  const [allSfx, setAllSfx] = useState<SfxMeta[]>([])
  const [selectedCategory, setSelectedCategory] = useState<SfxCategory | 'all' | 'recommended'>('recommended')
  const [search, setSearch] = useState('')
  const [pinned, setPinned] = useState<string[]>(loadSfxPins)
  const [tagsMap, setTagsMap] = useState<Record<string, string[]>>({})
  const [allTags, setAllTags] = useState<string[]>([])
  const sfxPlayer = useSfxPlayer()

  // Load SFX list on mount
  useEffect(() => {
    window.doty
      .getSfxList()
      .then(setAllSfx)
      .catch(() => setAllSfx([]))
  }, [])

  // Load tags on mount
  useEffect(() => {
    window.doty
      .getTagsMap()
      .then(setTagsMap)
      .catch(() => {})
    window.doty
      .getAllTags()
      .then(setAllTags)
      .catch(() => {})
  }, [])

  // Persist pins
  useEffect(() => {
    saveSfxPins(pinned)
  }, [pinned])

  // Derive categories present in the library
  const categories = useMemo(() => {
    const cats = new Set(allSfx.map((s) => s.category))
    return Object.keys(SFX_CATEGORY_LABELS).filter((c) => cats.has(c)) as SfxCategory[]
  }, [allSfx])

  function togglePin(sfxId: string) {
    setPinned((prev) => (prev.includes(sfxId) ? prev.filter((f) => f !== sfxId) : [...prev, sfxId]))
  }

  function handleTagsChange(filename: string, tags: string[]) {
    window.doty
      .setTags(filename, tags)
      .then(() => {
        setTagsMap((prev) => ({ ...prev, [filename]: tags }))
        window.doty
          .getAllTags()
          .then(setAllTags)
          .catch(() => {})
      })
      .catch(() => {})
  }

  // Build sections: Pinned, Suggested (minus pinned), then category/all/search
  const pinnedSet = new Set(pinned)
  const pinnedSfx = useMemo(() => {
    return pinned.map((id) => allSfx.find((s) => s.id === id)).filter((s): s is SfxMeta => !!s)
  }, [pinned, allSfx])

  // Filter SFX based on selected category and search
  const filteredSfx = useMemo(() => {
    let list = allSfx

    // When searching, search across ALL SFX regardless of selected tab
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list
        .filter((s) => !pinnedSet.has(s.id))
        .filter(
          (s) =>
            s.label.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q) ||
            s.category.toLowerCase().includes(q) ||
            (tagsMap[s.filename] || []).some((t) => t.includes(q)),
        )
      return list
    }

    if (selectedCategory === 'recommended') {
      const recSet = new Set(sfxRecommendations)
      list = list.filter((s) => recSet.has(s.id) && !pinnedSet.has(s.id))
      // Preserve recommendation order
      list.sort((a, b) => sfxRecommendations.indexOf(a.id) - sfxRecommendations.indexOf(b.id))
    } else if (selectedCategory !== 'all') {
      list = list.filter((s) => s.category === selectedCategory && !pinnedSet.has(s.id))
    } else {
      list = list.filter((s) => !pinnedSet.has(s.id))
    }

    return list
  }, [allSfx, selectedCategory, search, sfxRecommendations, pinnedSet, tagsMap])

  // Map sfxId -> active channel
  const activeChannelMap = useMemo(() => {
    const map = new Map<string, (typeof sfxPlayer.channels)[0]>()
    for (const ch of sfxPlayer.channels) {
      map.set(ch.sfxId, ch)
    }
    return map
  }, [sfxPlayer.channels])

  const hasActiveSfx = sfxPlayer.channels.length > 0

  function renderSfxCard(sfx: SfxMeta) {
    const ch = activeChannelMap.get(sfx.id)
    return (
      <SfxCard
        key={sfx.id}
        sfx={sfx}
        channelId={ch?.id ?? null}
        isPlaying={!!ch?.playing}
        isLooping={ch?.looping ?? false}
        isPinned={pinnedSet.has(sfx.id)}
        channelVolume={ch?.volume ?? sfxPlayer.getSfxVolume(sfx.id)}
        tags={tagsMap[sfx.filename] || []}
        allTags={allTags}
        onPlay={(loop) => sfxPlayer.play(sfx.id, sfx.label, sfx.filename, loop)}
        onStop={() => ch && sfxPlayer.stop(ch.id)}
        onToggleLoop={() => ch && sfxPlayer.toggleLoop(ch.id)}
        onVolumeChange={(v) => {
          sfxPlayer.setSfxVolume(sfx.id, v)
          if (ch) sfxPlayer.setChannelVolume(ch.id, v)
        }}
        onPin={() => togglePin(sfx.id)}
        onTagsChange={(tags) => handleTagsChange(sfx.filename, tags)}
      />
    )
  }

  return (
    <div className="h-full flex flex-col relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <span
          style={{
            fontFamily: "'Cinzel', serif",
            fontSize: '15px',
            letterSpacing: '0.25em',
            color: '#4a8a6a',
            textTransform: 'uppercase',
          }}
        >
          Arcane Effects
        </span>
        <div className="flex items-center gap-3">
          {allSfx.length > 0 && (
            <span style={{ fontSize: '16px', color: '#3a2e1a', fontFamily: 'monospace' }}>
              {allSfx.length} effects
              {pinned.length > 0 ? ` / ${pinned.length} pinned` : ''}
              {hasActiveSfx ? ` / ${sfxPlayer.channels.length} active` : ''}
            </span>
          )}
          {hasActiveSfx && (
            <button
              onClick={sfxPlayer.stopAll}
              className="p-1.5 hover:opacity-80 transition-opacity"
              title="Stop all effects"
              style={{ border: '1px solid rgba(74,138,106,0.3)', color: '#4a8a6a' }}
            >
              <StopIcon />
            </button>
          )}
        </div>
      </div>

      {/* Active channels strip */}
      {hasActiveSfx && (
        <div className="mb-2 shrink-0">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {sfxPlayer.channels.map((ch) => (
              <div
                key={ch.id}
                className="flex items-center gap-1.5 px-2 py-1 shrink-0"
                style={{
                  background: 'rgba(74,138,106,0.08)',
                  border: '1px solid rgba(74,138,106,0.25)',
                  fontSize: '11px',
                  fontFamily: "'Crimson Text', serif",
                  color: '#a8d5b8',
                }}
              >
                {ch.looping && <span style={{ fontSize: '8px', color: '#4a8a6a' }}>&#x21BB;</span>}
                <span className="truncate" style={{ maxWidth: '80px' }}>
                  {ch.label}
                </span>
                <button
                  onClick={() => sfxPlayer.stop(ch.id)}
                  className="w-3 h-3 flex items-center justify-center hover:opacity-80"
                  style={{ color: '#4a8a6a' }}
                >
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Master volume */}
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <span
          style={{
            fontSize: '10px',
            fontFamily: 'monospace',
            color: '#3a2e1a',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          SFX Vol
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(sfxPlayer.masterVolume * 100)}
          onChange={(e) => sfxPlayer.setMasterVolume(Number(e.target.value) / 100)}
          className="flex-1"
          style={{ accentColor: '#4a8a6a', height: '2px' }}
          aria-label="SFX master volume"
        />
        <span
          style={{ fontSize: '10px', fontFamily: 'monospace', color: '#3a2e1a', minWidth: '28px', textAlign: 'right' }}
        >
          {Math.round(sfxPlayer.masterVolume * 100)}%
        </span>
      </div>

      {/* Category tabs + search */}
      <div className="flex items-center gap-2 mb-2 shrink-0 overflow-x-auto">
        {/* Recommended tab */}
        <button
          onClick={() => setSelectedCategory('recommended')}
          className="px-2 py-0.5 shrink-0 transition-all"
          style={{
            fontSize: '10px',
            fontFamily: "'Cinzel', serif",
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: selectedCategory === 'recommended' ? '#4a8a6a' : '#3a2e1a',
            border: `1px solid ${selectedCategory === 'recommended' ? 'rgba(74,138,106,0.4)' : 'rgba(46,36,22,0.3)'}`,
            background: selectedCategory === 'recommended' ? 'rgba(74,138,106,0.08)' : 'transparent',
          }}
        >
          Suggested
        </button>

        {/* All tab */}
        <button
          onClick={() => setSelectedCategory('all')}
          className="px-2 py-0.5 shrink-0 transition-all"
          style={{
            fontSize: '10px',
            fontFamily: "'Cinzel', serif",
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: selectedCategory === 'all' ? '#4a8a6a' : '#3a2e1a',
            border: `1px solid ${selectedCategory === 'all' ? 'rgba(74,138,106,0.4)' : 'rgba(46,36,22,0.3)'}`,
            background: selectedCategory === 'all' ? 'rgba(74,138,106,0.08)' : 'transparent',
          }}
        >
          All
        </button>

        {/* Category tabs */}
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className="px-2 py-0.5 shrink-0 transition-all"
            style={{
              fontSize: '10px',
              fontFamily: "'Cinzel', serif",
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: selectedCategory === cat ? '#4a8a6a' : '#3a2e1a',
              border: `1px solid ${selectedCategory === cat ? 'rgba(74,138,106,0.4)' : 'rgba(46,36,22,0.3)'}`,
              background: selectedCategory === cat ? 'rgba(74,138,106,0.08)' : 'transparent',
            }}
          >
            {SFX_CATEGORY_LABELS[cat].split(' ')[0]}
          </button>
        ))}

        {/* Search */}
        <div
          className="flex items-center gap-1 ml-auto shrink-0"
          style={{
            border: '1px solid rgba(46,36,22,0.3)',
            padding: '2px 6px',
          }}
        >
          <SearchIcon />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="bg-transparent outline-none"
            style={{
              width: '80px',
              fontSize: '11px',
              fontFamily: "'Crimson Text', serif",
              color: '#c8b07a',
            }}
          />
        </div>
      </div>

      {/* SFX grid */}
      {allSfx.length === 0 ? (
        <div
          className="flex-1 flex flex-col items-center justify-center relative"
          style={{
            background: 'linear-gradient(160deg, #0f0d09, #080705)',
            border: '1px solid #2e2416',
          }}
        >
          <div
            className="absolute top-0 left-0 w-3 h-3"
            style={{ borderTop: '1px solid rgba(74,138,106,0.3)', borderLeft: '1px solid rgba(74,138,106,0.3)' }}
          />
          <div
            className="absolute bottom-0 right-0 w-3 h-3"
            style={{ borderBottom: '1px solid rgba(74,138,106,0.3)', borderRight: '1px solid rgba(74,138,106,0.3)' }}
          />
          <svg className="w-10 h-10 mb-4 opacity-10" viewBox="0 0 24 24" fill="#4a8a6a">
            <path d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5 8l4-4v16l-4-4H2V8h3z" />
          </svg>
          <p
            style={{
              fontFamily: "'Cinzel', serif",
              fontSize: '14px',
              color: '#4a8a6a',
              letterSpacing: '0.15em',
              textAlign: 'center',
              opacity: 0.6,
            }}
          >
            No sound effects available
          </p>
          <p
            style={{
              marginTop: '8px',
              fontSize: '13px',
              color: '#3a2e1a',
              fontFamily: "'Crimson Text', serif",
              textAlign: 'center',
            }}
          >
            Add a custom SFX directory in Settings
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Pinned section */}
          {pinnedSfx.length > 0 && (
            <>
              <div className="flex items-center gap-2 shrink-0 mb-1" style={{ height: '20px' }}>
                <PinIcon filled />
                <span
                  style={{
                    fontFamily: "'Cinzel', serif",
                    fontSize: '11px',
                    letterSpacing: '0.2em',
                    color: '#4a8a6a',
                    textTransform: 'uppercase',
                  }}
                >
                  Pinned
                </span>
                <div className="flex-1 h-px" style={{ background: 'rgba(74,138,106,0.15)' }} />
              </div>
              <div className="grid grid-cols-2 gap-1 mb-2">{pinnedSfx.map(renderSfxCard)}</div>
            </>
          )}

          {/* Suggested / Category / All section */}
          {filteredSfx.length > 0 ? (
            <>
              {pinnedSfx.length > 0 && (
                <div className="flex items-center gap-2 shrink-0 mb-1" style={{ height: '20px' }}>
                  <span style={{ fontSize: '10px', color: '#3a2e1a' }}>&#x2B21;</span>
                  <span
                    style={{
                      fontFamily: "'Cinzel', serif",
                      fontSize: '11px',
                      letterSpacing: '0.2em',
                      color: '#3a2e1a',
                      textTransform: 'uppercase',
                    }}
                  >
                    {selectedCategory === 'recommended'
                      ? 'Suggested'
                      : selectedCategory === 'all'
                        ? 'All Effects'
                        : (SFX_CATEGORY_LABELS[selectedCategory as SfxCategory]?.split(' ')[0] ?? 'Effects')}
                  </span>
                  <div className="flex-1 h-px" style={{ background: 'rgba(46,36,22,0.5)' }} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-1">{filteredSfx.map(renderSfxCard)}</div>
            </>
          ) : pinnedSfx.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', color: '#3a2e1a', letterSpacing: '0.1em' }}>
                {selectedCategory === 'recommended' ? 'No suggested effects yet' : 'No effects match your search'}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
