import { useState, useEffect } from 'react'
import type { TrackMeta } from '../types'
import { PinIcon, BrowseIcon } from './Icons'
import PlayerBar from './PlayerBar'
import TrackCard from './TrackCard'
import BrowsePanel from './BrowsePanel'
import { useAudioPlayer } from '../hooks/useAudioPlayer'

const PINS_KEY = 'doty:pinnedTracks'

function loadPins(): string[] {
  try { return JSON.parse(localStorage.getItem(PINS_KEY) || '[]') } catch { return [] }
}
function savePins(pins: string[]) {
  localStorage.setItem(PINS_KEY, JSON.stringify(pins))
}

interface Props {
  recommendations: string[]
  musicFolder: string
  speakerDeviceId?: string
  onNoFolder: () => void
}

export default function Soundboard({ recommendations, musicFolder, speakerDeviceId, onNoFolder }: Props) {
  const [pinned, setPinned] = useState<string[]>(loadPins)
  const [browsing, setBrowsing] = useState(false)
  const [metaMap, setMetaMap] = useState<Record<string, TrackMeta>>({})

  const { playing, isAudioPlaying, progress, playTrack, seekTo } = useAudioPlayer({
    speakerDeviceId,
    onNoFolder,
    musicFolder,
  })

  // Fetch metadata once on mount (and when music folder changes)
  useEffect(() => {
    if (!musicFolder) return
    window.doty.getAllMetadata().then(setMetaMap).catch(() => {})
  }, [musicFolder])

  // Re-fetch metadata after scan completes
  useEffect(() => {
    const unsub = window.doty.onScanComplete(() => {
      window.doty.getAllMetadata().then(setMetaMap).catch(() => {})
    })
    return unsub
  }, [])

  // Persist pins
  useEffect(() => { savePins(pinned) }, [pinned])

  function togglePin(filename: string) {
    setPinned(prev =>
      prev.includes(filename)
        ? prev.filter(f => f !== filename)
        : [...prev, filename]
    )
  }

  function movePin(filename: string, dir: -1 | 1) {
    setPinned(prev => {
      const idx = prev.indexOf(filename)
      if (idx < 0) return prev
      const newIdx = idx + dir
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
      return next
    })
  }

  // Suggestions = recommendations minus pinned, plus currently playing track if not pinned
  const suggestions = recommendations.filter(f => !pinned.includes(f))
  if (playing && !pinned.includes(playing) && !suggestions.includes(playing)) {
    suggestions.unshift(playing)
  }

  const emptyState = (msg: string, sub?: string) => (
    <div className="flex-1 flex flex-col items-center justify-center relative" style={{
      background: 'linear-gradient(160deg, #0f0d09, #080705)',
      border: '1px solid #2e2416',
    }}>
      <div className="absolute top-0 left-0 w-3 h-3" style={{ borderTop: '1px solid rgba(200,146,42,0.3)', borderLeft: '1px solid rgba(200,146,42,0.3)' }} />
      <div className="absolute bottom-0 right-0 w-3 h-3" style={{ borderBottom: '1px solid rgba(200,146,42,0.3)', borderRight: '1px solid rgba(200,146,42,0.3)' }} />
      <svg className="w-10 h-10 mb-4 opacity-10" viewBox="0 0 24 24" fill="#c8922a">
        <path d="M12 15.5A3.5 3.5 0 018.5 12 3.5 3.5 0 0112 8.5a3.5 3.5 0 013.5 3.5 3.5 3.5 0 01-3.5 3.5m7.43-2.92c.04-.34.07-.68.07-1.08s-.03-.74-.07-1.08l2.32-1.82c.21-.16.27-.46.13-.7l-2.2-3.82c-.13-.24-.42-.32-.66-.24l-2.74 1.1c-.57-.44-1.18-.8-1.86-1.08L14.5 2.42c-.04-.26-.27-.42-.5-.42h-4c-.23 0-.46.16-.5.42L9.13 5.36C8.45 5.64 7.84 6 7.27 6.44L4.53 5.34c-.24-.08-.53 0-.66.24L1.67 9.4c-.14.24-.08.54.13.7l2.32 1.82c-.04.34-.07.69-.07 1.08s.03.74.07 1.08L1.8 15.9c-.21.16-.27.46-.13.7l2.2 3.82c.13.24.42.32.66.24l2.74-1.1c.57.44 1.18.8 1.86 1.08l.37 2.94c.04.26.27.42.5.42h4c.23 0 .46-.16.5-.42l.37-2.94c.68-.28 1.29-.64 1.86-1.08l2.74 1.1c.24.08.53 0 .66-.24l2.2-3.82c.14-.24.08-.54-.13-.7l-2.32-1.82z" />
      </svg>
      <p style={{ fontFamily: "'Cinzel', serif", fontSize: '14px', color: '#6b4e15', letterSpacing: '0.15em', textAlign: 'center' }}>{msg}</p>
      {sub && (
        <button onClick={onNoFolder} style={{ marginTop: '10px', fontSize: '14px', color: '#c8922a', fontFamily: "'Cinzel', serif", letterSpacing: '0.1em', opacity: 0.7 }}>
          {sub}
        </button>
      )}
    </div>
  )

  const hasTracks = pinned.length > 0 || suggestions.length > 0

  return (
    <div className="h-full flex flex-col relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <span style={{
          fontFamily: "'Cinzel', serif",
          fontSize: '15px',
          letterSpacing: '0.25em',
          color: '#6b4e15',
          textTransform: 'uppercase',
        }}>
          Melodic Compendium
        </span>
        <div className="flex items-center gap-3">
          {hasTracks && (
            <span style={{ fontSize: '16px', color: '#3a2e1a', fontFamily: 'monospace' }}>
              {pinned.length > 0 ? `${pinned.length} pinned` : ''}{pinned.length > 0 && suggestions.length > 0 ? ' / ' : ''}{suggestions.length > 0 ? `${suggestions.length} attuned` : ''}
            </span>
          )}
          {musicFolder && (
            <button
              onClick={() => setBrowsing(true)}
              className="p-1.5 hover:opacity-80 transition-opacity"
              title="Browse all tracks"
              style={{ border: '1px solid #2e2416' }}
            >
              <BrowseIcon />
            </button>
          )}
        </div>
      </div>

      {!musicFolder
        ? emptyState('No archive selected', 'Open Configuration')
        : !hasTracks
          ? emptyState('Speak or describe the mood below')
          : (
            <div className="flex-1 min-h-0 flex flex-col gap-px overflow-y-auto">
              {/* Pinned section label */}
              {pinned.length > 0 && (
                <div className="flex items-center gap-2 shrink-0" style={{ height: '20px' }}>
                  <PinIcon filled />
                  <span style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.2em', color: '#6b4e15', textTransform: 'uppercase' }}>
                    Pinned
                  </span>
                  <div className="flex-1 h-px" style={{ background: 'rgba(200,146,42,0.15)' }} />
                </div>
              )}
              {pinned.map((f, i) => (
                <TrackCard
                  key={`pin-${f}`}
                  filename={f}
                  isPlaying={playing === f}
                  isPinned
                  rank={i + 1}
                  showReorder
                  canMoveUp={i > 0}
                  canMoveDown={i < pinned.length - 1}
                  meta={metaMap[f]}
                  onPlay={() => playTrack(f)}
                  onPin={() => togglePin(f)}
                  onMoveUp={() => movePin(f, -1)}
                  onMoveDown={() => movePin(f, 1)}
                />
              ))}

              {/* Suggestions section label */}
              {suggestions.length > 0 && (
                <div className="flex items-center gap-2 shrink-0" style={{ height: '20px' }}>
                  <span style={{ fontSize: '10px', color: '#3a2e1a' }}>&#x2B21;</span>
                  <span style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.2em', color: '#3a2e1a', textTransform: 'uppercase' }}>
                    Suggestions
                  </span>
                  <div className="flex-1 h-px" style={{ background: 'rgba(46,36,22,0.5)' }} />
                </div>
              )}
              {suggestions.map((f, i) => (
                <TrackCard
                  key={`sug-${f}`}
                  filename={f}
                  isPlaying={playing === f}
                  isPinned={false}
                  rank={pinned.length + i + 1}
                  showReorder={false}
                  canMoveUp={false}
                  canMoveDown={false}
                  meta={metaMap[f]}
                  onPlay={() => playTrack(f)}
                  onPin={() => togglePin(f)}
                  onMoveUp={() => {}}
                  onMoveDown={() => {}}
                />
              ))}
            </div>
          )
      }

      {/* Browse all tracks panel */}
      {browsing && musicFolder && (
        <BrowsePanel
          pinned={pinned}
          playing={playing}
          onPlay={playTrack}
          onPin={togglePin}
          onClose={() => setBrowsing(false)}
        />
      )}

      {/* Persistent player bar */}
      {playing && (
        <PlayerBar
          filename={playing}
          isPlaying={isAudioPlaying}
          progress={progress}
          onToggle={() => playTrack(playing)}
          onSeek={seekTo}
        />
      )}
    </div>
  )
}
