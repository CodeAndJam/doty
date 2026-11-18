import { useEffect, useMemo, useState } from 'react'
import { useLibrarySearch } from '../hooks/useLibrarySearch'
import type { UseSfxPlayerReturn } from '../hooks/useSfxPlayer'
import { searchModeLabel } from '../lib/searchLabel'
import type { SfxCategory, SfxMeta } from '../types'
import { SFX_CATEGORY_LABELS } from '../types'
import { CloseIcon, PinIcon, SearchIcon, StopIcon } from './Icons'
import SfxCard from './SfxCard'

interface SfxBrowsePanelProps {
  sfxPlayer: UseSfxPlayerReturn
  sfxRecommendations: string[]
  sfxPinned: string[]
  onTogglePin: (sfxId: string) => void
  onClose: () => void
}

export default function SfxBrowsePanel({
  sfxPlayer,
  sfxRecommendations,
  sfxPinned,
  onTogglePin,
  onClose,
}: SfxBrowsePanelProps) {
  const [allSfx, setAllSfx] = useState<SfxMeta[]>([])
  const [lanes, setLanes] = useState<Record<string, { key: string; lane: 'music' | 'sfx'; origin: 'music' | 'sfx' }>>(
    {},
  )
  const [selectedCategory, setSelectedCategory] = useState<SfxCategory | 'all' | 'recommended'>('all')
  const [search, setSearch] = useState('')
  const [tagsMap, setTagsMap] = useState<Record<string, string[]>>({})
  const [allTags, setAllTags] = useState<string[]>([])

  const refresh = async () => {
    // Settled independently: a failed lane lookup must not empty the shelf.
    const [list, next] = await Promise.all([
      window.doty.getSfxList().catch(() => null),
      window.doty.libraryLanes().catch(() => null),
    ])
    if (list) setAllSfx(list)
    if (next) setLanes(next)
  }

  // Load SFX list on mount, and follow a lane change made anywhere else.
  useEffect(() => {
    void refresh()
    const unsubScan = window.doty.onScanComplete(() => void refresh())
    const unsubSfx = window.doty.onSfxChanged(() => void refresh())
    return () => {
      unsubScan()
      unsubSfx()
    }
  }, [])

  /** Label, never a disk move. */
  async function switchLane(filename: string) {
    const info = lanes[filename]
    if (!info) return
    await window.doty.setLane(info.key, info.lane === 'music' ? 'sfx' : 'music')
    await refresh()
  }

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

  // Escape to close
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

  // Derive categories present in the library
  const categories = useMemo(() => {
    const cats = new Set(allSfx.map((s) => s.category))
    return Object.keys(SFX_CATEGORY_LABELS).filter((c) => cats.has(c)) as SfxCategory[]
  }, [allSfx])

  const pinnedSet = new Set(sfxPinned)

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

  const found = useLibrarySearch(search, 'sfx', 12)

  // Filter SFX based on selected category and search
  const filteredSfx = useMemo(() => {
    let list = allSfx

    // When searching, the library answers across the whole shelf, ignoring the
    // selected tab: a DM looking for a sound does not think in categories.
    if (search.trim()) {
      if (!found) return list
      const byFile = new Map(allSfx.map((s) => [s.filename, s]))
      return found.hits.map((hit) => byFile.get(hit.absolute)).filter((s): s is SfxMeta => Boolean(s))
    }

    if (selectedCategory === 'recommended') {
      const recSet = new Set(sfxRecommendations)
      list = list.filter((s) => recSet.has(s.id))
      list.sort((a, b) => sfxRecommendations.indexOf(a.id) - sfxRecommendations.indexOf(b.id))
    } else if (selectedCategory !== 'all') {
      list = list.filter((s) => s.category === selectedCategory)
    }

    return list
  }, [allSfx, selectedCategory, search, sfxRecommendations, tagsMap, found])

  // Map sfxId -> active channel
  const activeChannelMap = useMemo(() => {
    const map = new Map<string, (typeof sfxPlayer.channels)[0]>()
    for (const ch of sfxPlayer.channels) map.set(ch.sfxId, ch)
    return map
  }, [sfxPlayer.channels])

  const hasActiveSfx = sfxPlayer.channels.length > 0

  function renderSfxCard(sfx: SfxMeta) {
    const ch = activeChannelMap.get(sfx.id)
    const lane = lanes[sfx.filename]
    return (
      <SfxCard
        key={sfx.id}
        badge={
          <button
            type="button"
            data-testid="lane-badge"
            onClick={(e) => {
              e.stopPropagation()
              void switchLane(sfx.filename)
            }}
            disabled={!lane}
            aria-label={
              lane
                ? `Filed as ${lane.lane === 'music' ? 'music' : 'an effect'}; switch to the other shelf`
                : 'Lane unknown'
            }
            title={
              lane ? `Filed as ${lane.lane === 'music' ? 'music' : 'an effect'} — click to change` : 'Lane unknown'
            }
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: '11px',
              padding: '0 4px',
              color: lane?.lane === 'music' ? '#6dbf95' : '#b06a2a',
              border: `1px solid ${lane && lane.lane !== lane.origin ? 'rgba(200,146,42,0.6)' : 'transparent'}`,
            }}
          >
            {lane?.lane === 'music' ? '♪' : 'FX'}
          </button>
        }
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
        }}
        onPin={() => onTogglePin(sfx.id)}
        onTagsChange={(tags) => handleTagsChange(sfx.filename, tags)}
      />
    )
  }

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col"
      style={{ background: '#080705', border: '1px solid rgba(74,138,106,0.3)' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid rgba(74,138,106,0.3)' }}
      >
        <SearchIcon />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search effects"
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ fontFamily: "'Crimson Text', serif", fontSize: '14px', color: '#6dbf95' }}
        />
        {search.trim() && (!found || found.pending) && (
          <span
            role="status"
            aria-live="polite"
            className="animate-pulse"
            style={{ fontSize: '11px', color: '#6dbf95', fontFamily: "'IBM Plex Mono', monospace" }}
          >
            searching…
          </span>
        )}
        {search.trim() && found && (
          <span
            data-testid="search-mode"
            role="status"
            aria-live="polite"
            style={{
              fontSize: '11px',
              color: found.mode === 'semantic' ? '#6dbf95' : '#b06a2a',
              fontFamily: "'IBM Plex Mono', monospace",
            }}
            title="How this answer was found"
          >
            {searchModeLabel(found.mode, found.index)}
          </span>
        )}
        <span style={{ fontSize: '12px', color: '#9d8b66', fontFamily: "'IBM Plex Mono', monospace" }}>
          {filteredSfx.length}
        </span>
        {hasActiveSfx && (
          <button
            type="button"
            onClick={sfxPlayer.stopAll}
            className="p-1 hover:opacity-80 transition-opacity"
            title="Stop all effects"
            style={{ color: '#6dbf95' }}
          >
            <StopIcon />
          </button>
        )}
        <button
          type="button"
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

      {/* Active channels strip */}
      {hasActiveSfx && (
        <div className="px-3 py-1.5 shrink-0" style={{ borderBottom: '1px solid rgba(46,36,22,0.3)' }}>
          <div className="flex items-center gap-1 overflow-x-auto">
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
                {ch.looping && <span style={{ fontSize: '8px', color: '#6dbf95' }}>&#x21BB;</span>}
                <span className="truncate" style={{ maxWidth: '80px' }}>
                  {ch.label}
                </span>
                <button
                  type="button"
                  onClick={() => sfxPlayer.stop(ch.id)}
                  className="w-3 h-3 flex items-center justify-center hover:opacity-80"
                  style={{ color: '#6dbf95' }}
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
      <div
        className="flex items-center gap-2 px-3 py-1.5 shrink-0"
        style={{ borderBottom: '1px solid rgba(46,36,22,0.3)' }}
      >
        <span
          style={{
            fontSize: '11px',
            fontFamily: "'IBM Plex Mono', monospace",
            color: '#9d8b66',
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
          style={{ accentColor: '#6dbf95', height: '2px' }}
          aria-label="SFX master volume"
        />
        <span
          style={{
            fontSize: '11px',
            fontFamily: "'IBM Plex Mono', monospace",
            color: '#9d8b66',
            minWidth: '28px',
            textAlign: 'right',
          }}
        >
          {Math.round(sfxPlayer.masterVolume * 100)}%
        </span>
      </div>

      {/* Category tabs */}
      <div
        className="flex items-center gap-1 px-3 py-1.5 shrink-0 overflow-x-auto"
        style={{ borderBottom: '1px solid rgba(46,36,22,0.3)' }}
      >
        <button
          type="button"
          onClick={() => setSelectedCategory('all')}
          className="px-2 py-0.5 shrink-0 transition-all"
          style={{
            fontSize: '11px',
            fontFamily: "'Cinzel', serif",
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: selectedCategory === 'all' ? '#6dbf95' : '#9d8b66',
            border: `1px solid ${selectedCategory === 'all' ? 'rgba(74,138,106,0.4)' : 'rgba(46,36,22,0.3)'}`,
            background: selectedCategory === 'all' ? 'rgba(74,138,106,0.08)' : 'transparent',
          }}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setSelectedCategory('recommended')}
          className="px-2 py-0.5 shrink-0 transition-all"
          style={{
            fontSize: '11px',
            fontFamily: "'Cinzel', serif",
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: selectedCategory === 'recommended' ? '#6dbf95' : '#9d8b66',
            border: `1px solid ${selectedCategory === 'recommended' ? 'rgba(74,138,106,0.4)' : 'rgba(46,36,22,0.3)'}`,
            background: selectedCategory === 'recommended' ? 'rgba(74,138,106,0.08)' : 'transparent',
          }}
        >
          Suggested
        </button>
        {categories.map((cat) => (
          <button
            type="button"
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className="px-2 py-0.5 shrink-0 transition-all"
            style={{
              fontSize: '11px',
              fontFamily: "'Cinzel', serif",
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: selectedCategory === cat ? '#6dbf95' : '#9d8b66',
              border: `1px solid ${selectedCategory === cat ? 'rgba(74,138,106,0.4)' : 'rgba(46,36,22,0.3)'}`,
              background: selectedCategory === cat ? 'rgba(74,138,106,0.08)' : 'transparent',
            }}
          >
            {SFX_CATEGORY_LABELS[cat].split(' ')[0]}
          </button>
        ))}
      </div>

      {/* SFX grid */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {/* Pinned section */}
        {sfxPinned.length > 0 && (
          <>
            <div className="flex items-center gap-2 shrink-0 mb-1" style={{ height: '20px' }}>
              <PinIcon filled />
              <span
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: '11px',
                  letterSpacing: '0.2em',
                  color: '#6dbf95',
                  textTransform: 'uppercase',
                }}
              >
                Pinned
              </span>
              <div className="flex-1 h-px" style={{ background: 'rgba(74,138,106,0.15)' }} />
            </div>
            <div className="grid grid-cols-3 gap-1 mb-3">
              {sfxPinned
                .map((id) => allSfx.find((s) => s.id === id))
                .filter((s): s is SfxMeta => !!s)
                .map(renderSfxCard)}
            </div>
          </>
        )}

        {/* Filtered section */}
        {filteredSfx.length > 0 ? (
          <>
            {sfxPinned.length > 0 && (
              <div className="flex items-center gap-2 shrink-0 mb-1" style={{ height: '20px' }}>
                <span style={{ fontSize: '11px', color: '#9d8b66' }}>&#x2B21;</span>
                <span
                  style={{
                    fontFamily: "'Cinzel', serif",
                    fontSize: '11px',
                    letterSpacing: '0.2em',
                    color: '#9d8b66',
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
            <div className="grid grid-cols-3 gap-1">{filteredSfx.map(renderSfxCard)}</div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center py-8">
            <p style={{ fontFamily: "'Cinzel', serif", fontSize: '13px', color: '#9d8b66', letterSpacing: '0.1em' }}>
              {selectedCategory === 'recommended' ? 'No suggested effects yet' : 'No effects match your search'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
