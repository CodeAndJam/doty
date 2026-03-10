import { useState, useEffect } from 'react'
import Transcript from './Transcript'
import Soundboard from './Soundboard'
import Settings from './Settings'
import { useRecorder } from '../hooks/useRecorder'

export default function MainLayout() {
  const [recording, setRecording] = useState(false)
  const [transcripts, setTranscripts] = useState<string[]>([])
  const [recommendations, setRecommendations] = useState<string[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [musicFolder, setMusicFolder] = useState('')
  const { start, stop } = useRecorder()

  useEffect(() => {
    window.doty.getMusicFolder().then(setMusicFolder)

    const unsubTranscript = window.doty.onTranscript((text) => {
      setTranscripts((prev) => [...prev, text])
    })
    const unsubRec = window.doty.onRecommendations((files) => {
      setRecommendations(files)
    })

    return () => {
      unsubTranscript()
      unsubRec()
    }
  }, [])

  async function toggleRecording() {
    if (recording) {
      stop()
      await window.doty.sttStop()
      setRecording(false)
    } else {
      await window.doty.sttStart()
      await start()
      setRecording(true)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-surface overflow-hidden">
      {/* Title bar drag region */}
      <div
        className="fixed top-0 left-0 right-0 h-8 z-50"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-10 pb-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400" />
          <span className="text-xs text-gray-400">Ready</span>
        </div>
        <h1 className="text-sm font-semibold tracking-widest text-gray-300 uppercase">Doty</h1>
        <button
          onClick={() => setShowSettings(true)}
          className="p-1.5 rounded-lg hover:bg-panel transition-colors text-gray-400 hover:text-gray-200"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </header>

      {/* Main content */}
      <div className="flex flex-1 gap-4 px-5 pb-5 overflow-hidden">
        {/* Left: Transcript + Record button */}
        <div className="flex flex-col w-80 shrink-0 gap-4">
          <Transcript lines={transcripts} recording={recording} />
          <button
            onClick={toggleRecording}
            className={`
              flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all
              ${recording
                ? 'bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30'
                : 'bg-accent hover:bg-accent/80 text-white'
              }
            `}
          >
            {recording ? (
              <>
                <span className="w-3 h-3 bg-red-400 rounded-sm" />
                Stop Recording
              </>
            ) : (
              <>
                <span className="w-3 h-3 bg-white rounded-full" />
                Start Recording
              </>
            )}
          </button>
        </div>

        {/* Right: Soundboard */}
        <div className="flex-1 overflow-hidden">
          <Soundboard
            recommendations={recommendations}
            musicFolder={musicFolder}
            onNoFolder={() => setShowSettings(true)}
          />
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onFolderChange={setMusicFolder}
        />
      )}
    </div>
  )
}
