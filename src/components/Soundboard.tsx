import { useState, useRef, useEffect } from 'react'

interface Props {
  recommendations: string[]
  musicFolder: string
  onNoFolder: () => void
}

interface Track {
  filename: string
  url: string
}

export default function Soundboard({ recommendations, musicFolder, onNoFolder }: Props) {
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setPlaying(null)
  }, [recommendations])

  function togglePlay(filename: string) {
    if (!musicFolder) { onNoFolder(); return }

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    if (playing === filename) {
      setPlaying(null)
      return
    }

    const audio = new Audio(`music://${encodeURIComponent(filename)}`)
    audio.onended = () => setPlaying(null)
    audio.onerror = () => setPlaying(null)
    audio.play()
    audioRef.current = audio
    setPlaying(filename)
  }

  useEffect(() => {
    return () => { audioRef.current?.pause() }
  }, [])

  const tracks: Track[] = recommendations.map((f) => ({ filename: f, url: `music://${encodeURIComponent(f)}` }))

  const emptyState = (msg: string, sub?: string) => (
    <div className="flex-1 flex flex-col items-center justify-center relative" style={{
      background: 'linear-gradient(160deg, #0f0d09, #080705)',
      border: '1px solid #2e2416',
    }}>
      <div className="absolute top-0 left-0 w-3 h-3" style={{ borderTop: '1px solid rgba(200,146,42,0.3)', borderLeft: '1px solid rgba(200,146,42,0.3)' }} />
      <div className="absolute bottom-0 right-0 w-3 h-3" style={{ borderBottom: '1px solid rgba(200,146,42,0.3)', borderRight: '1px solid rgba(200,146,42,0.3)' }} />
      {/* Decorative gear */}
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

  return (
    <div className="h-full flex flex-col">
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
        {recommendations.length > 0 && (
          <span style={{ fontSize: '16px', color: '#3a2e1a', fontFamily: 'monospace' }}>
            {recommendations.length} attuned
          </span>
        )}
      </div>

      {!musicFolder
        ? emptyState('No archive selected', 'Open Configuration')
        : recommendations.length === 0
          ? emptyState('Speak or describe the mood below')
          : (
            <div className="flex-1 grid grid-cols-2 gap-2.5 overflow-y-auto pr-1">
              {tracks.map((track, i) => {
                const isPlaying = playing === track.filename
                const name = track.filename.replace(/\.[^.]+$/, '').replace(/.*[/\\]/, '')
                return (
                  <button
                    key={track.filename}
                    data-testid="track-card"
                    onClick={() => togglePlay(track.filename)}
                    className="relative flex flex-col items-start p-3.5 text-left transition-all"
                    style={{
                      background: isPlaying
                        ? 'linear-gradient(135deg, rgba(200,146,42,0.12), rgba(107,78,21,0.06))'
                        : 'linear-gradient(160deg, #0f0d09, #080705)',
                      border: `1px solid ${isPlaying ? 'rgba(200,146,42,0.5)' : '#2e2416'}`,
                      boxShadow: isPlaying
                        ? '0 0 16px rgba(200,146,42,0.2), inset 0 1px 0 rgba(200,146,42,0.08)'
                        : 'inset 0 1px 0 rgba(255,255,255,0.02)',
                    }}
                  >
                    {/* Corner ornaments on active */}
                    {isPlaying && <>
                      <div className="absolute top-0 left-0 w-2 h-2" style={{ borderTop: '1px solid rgba(200,146,42,0.6)', borderLeft: '1px solid rgba(200,146,42,0.6)' }} />
                      <div className="absolute bottom-0 right-0 w-2 h-2" style={{ borderBottom: '1px solid rgba(200,146,42,0.6)', borderRight: '1px solid rgba(200,146,42,0.6)' }} />
                    </>}

                    {/* Rank */}
                    <span className="absolute top-2 right-2.5" style={{
                      fontFamily: 'monospace', fontSize: '15px',
                      color: isPlaying ? 'rgba(200,146,42,0.5)' : '#2e2416'
                    }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>

                    {/* Play icon */}
                    <div className="w-7 h-7 flex items-center justify-center mb-2.5" style={{
                      border: `1px solid ${isPlaying ? 'rgba(200,146,42,0.5)' : '#2e2416'}`,
                      background: isPlaying ? 'rgba(200,146,42,0.1)' : 'transparent',
                    }}>
                      {isPlaying ? (
                        <svg className="w-3 h-3" fill="#c8922a" viewBox="0 0 24 24">
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                        </svg>
                      ) : (
                        <svg className="w-3 h-3" fill="#6b4e15" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </div>

                    <span className="line-clamp-2 leading-snug" style={{
                      fontFamily: "'Crimson Text', serif",
                      fontSize: '16px',
                      color: isPlaying ? '#e8d5a3' : '#8a7050',
                      lineHeight: '1.4',
                    }}>
                      {name}
                    </span>

                    {/* Waveform bars */}
                    {isPlaying && (
                      <div className="flex items-end gap-px mt-2" style={{ height: '10px' }}>
                        {[0.4, 0.7, 1, 0.6, 0.8, 0.5, 0.9].map((h, b) => (
                          <div
                            key={b}
                            className="w-px rounded-full animate-bounce"
                            style={{
                              height: `${h * 100}%`,
                              background: '#c8922a',
                              opacity: 0.7,
                              animationDelay: `${b * 0.08}s`,
                              animationDuration: '0.6s',
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )
      }
    </div>
  )
}
