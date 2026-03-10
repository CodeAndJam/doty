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

  // Stop playback when recommendations change
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setPlaying(null)
  }, [recommendations])

  function togglePlay(filename: string) {
    if (!musicFolder) {
      onNoFolder()
      return
    }

    // Stop current
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
    }
  }, [])

  const tracks: Track[] = recommendations.map((f) => ({ filename: f, url: `music://${encodeURIComponent(f)}` }))

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          Soundboard
        </span>
        {recommendations.length > 0 && (
          <span className="text-xs text-gray-600">{recommendations.length} recommendations</span>
        )}
      </div>

      {!musicFolder ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-panel border border-border rounded-xl">
          <svg className="w-8 h-8 text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <p className="text-sm text-gray-500 mb-3">No music folder selected</p>
          <button
            onClick={onNoFolder}
            className="text-xs text-accent hover:text-accent/80 transition-colors"
          >
            Open Settings
          </button>
        </div>
      ) : recommendations.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-panel border border-border rounded-xl">
          <svg className="w-8 h-8 text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <p className="text-sm text-gray-500">Start recording to get recommendations</p>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-2 gap-3 overflow-y-auto pr-1">
          {tracks.map((track, i) => {
            const isPlaying = playing === track.filename
            const name = track.filename.replace(/\.[^.]+$/, '')
            return (
              <button
                key={track.filename}
                onClick={() => togglePlay(track.filename)}
                className={`
                  relative flex flex-col items-start p-4 rounded-xl border text-left transition-all
                  ${isPlaying
                    ? 'bg-accent/20 border-accent/60 shadow-lg shadow-accent/10'
                    : 'bg-panel border-border hover:border-accent/40 hover:bg-panel/80'
                  }
                `}
              >
                {/* Rank badge */}
                <span className="absolute top-2 right-2 text-xs text-gray-600 font-mono">
                  #{i + 1}
                </span>

                {/* Play/pause icon */}
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 ${isPlaying ? 'bg-accent' : 'bg-border'}`}>
                  {isPlaying ? (
                    <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-gray-300" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </div>

                <span className="text-sm font-medium text-gray-200 line-clamp-2 leading-snug">
                  {name}
                </span>

                {isPlaying && (
                  <div className="flex items-end gap-0.5 mt-2 h-3">
                    {[1, 2, 3, 4].map((b) => (
                      <div
                        key={b}
                        className="w-0.5 bg-accent rounded-full animate-bounce"
                        style={{ height: `${40 + b * 15}%`, animationDelay: `${b * 0.1}s` }}
                      />
                    ))}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
