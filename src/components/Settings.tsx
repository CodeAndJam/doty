import { useState, useEffect } from 'react'
import type { ScanProgress } from '../types'

interface Props {
  onClose: () => void
  onFolderChange: (folder: string) => void
}

export default function Settings({ onClose, onFolderChange }: Props) {
  const [folder, setFolder] = useState('')
  const [trackCount, setTrackCount] = useState(0)
  const [modelReady, setModelReady] = useState(false)
  const [transcriptFolder, setTranscriptFolder] = useState('')
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
  const [scanDone, setScanDone] = useState(false)
  const [lastScanTime, setLastScanTime] = useState<string | null>(null)

  useEffect(() => {
    window.doty.getMusicFolder().then((f) => {
      setFolder(f)
      if (f) refreshTrackCount()
    })
    window.doty.modelStatus().then(({ ready }) => setModelReady(ready))
    window.doty.getTranscriptFolder().then(setTranscriptFolder)

    const unsubProgress = window.doty.onScanProgress((p) => {
      setScanProgress(p)
      setScanDone(false)
    })
    const unsubComplete = window.doty.onScanComplete(() => {
      setScanProgress(null)
      setScanDone(true)
      setLastScanTime(new Date().toLocaleTimeString())
    })
    return () => {
      unsubProgress()
      unsubComplete()
    }
  }, [])

  async function refreshTrackCount() {
    const files = await window.doty.listMusic()
    setTrackCount(files.length)
  }

  async function pickFolder() {
    const picked = await window.doty.pickMusicFolder()
    if (picked) {
      setFolder(picked)
      onFolderChange(picked)
      refreshTrackCount()
      setScanDone(false)
      setScanProgress(null)
    }
  }

  async function pickTranscriptFolder() {
    const picked = await window.doty.pickTranscriptFolder()
    if (picked) setTranscriptFolder(picked)
  }

  async function rescan() {
    setScanDone(false)
    setScanProgress(null)
    await window.doty.triggerScan()
  }

  const scanPercent = scanProgress && scanProgress.total > 0
    ? Math.round((scanProgress.done / scanProgress.total) * 100)
    : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-panel border border-border rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-base font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-border transition-colors text-gray-400 hover:text-gray-200"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Music folder */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
            Music Folder
          </label>
          <div className="flex gap-2">
            <div className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-gray-300 truncate">
              {folder || <span className="text-gray-600">No folder selected</span>}
            </div>
            <button
              onClick={pickFolder}
              className="px-3 py-2 bg-accent hover:bg-accent/80 rounded-lg text-sm font-medium transition-colors shrink-0"
            >
              Browse
            </button>
          </div>
          {folder && (
            <p className="text-xs text-gray-500 mt-1.5">{trackCount} audio files found (including subfolders)</p>
          )}
        </div>

        {/* Scan status */}
        {folder && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                Audio Analysis
              </label>
              <button
                onClick={rescan}
                disabled={!!scanProgress}
                className="text-xs text-accent hover:text-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Re-scan
              </button>
            </div>

            {scanProgress ? (
              <div className="space-y-1.5">
                <div className="w-full bg-border rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-200"
                    style={{ width: `${scanPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span className="truncate max-w-[70%]">{scanProgress.current}</span>
                  <span>{scanProgress.done} / {scanProgress.total}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className={`w-1.5 h-1.5 rounded-full ${scanDone ? 'bg-green-400' : 'bg-gray-600'}`} />
                {scanDone
                  ? `Analysis complete${lastScanTime ? ` · ${lastScanTime}` : ''}`
                  : 'Waiting to analyze…'}
              </div>
            )}
          </div>
        )}

        {/* Transcript folder */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
            Transcript Folder
          </label>
          <div className="flex gap-2">
            <div className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-gray-300 truncate">
              {transcriptFolder || <span className="text-gray-600">No folder selected</span>}
            </div>
            <button
              onClick={pickTranscriptFolder}
              className="px-3 py-2 bg-accent hover:bg-accent/80 rounded-lg text-sm font-medium transition-colors shrink-0"
            >
              Browse
            </button>
          </div>
          {transcriptFolder && (
            <p className="text-xs text-gray-500 mt-1.5">Transcripts saved automatically as .txt files</p>
          )}
        </div>

        {/* Model status */}
        <div>
          <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
            AI Model
          </label>
          <div className="flex items-center gap-3 bg-surface border border-border rounded-lg px-3 py-2.5">
            <div className={`w-2 h-2 rounded-full shrink-0 ${modelReady ? 'bg-green-400' : 'bg-yellow-400'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-300">Qwen2.5-0.5B</p>
              <p className="text-xs text-gray-500">{modelReady ? 'Ready' : 'Not downloaded'}</p>
            </div>
            {!modelReady && <span className="text-xs text-gray-500">~500 MB</span>}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-border">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-border hover:bg-border/80 rounded-xl text-sm font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
