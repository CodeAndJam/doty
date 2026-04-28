import { useEffect, useState } from 'react'
import type { ProgressPayload } from '../types'

interface ModelEntry {
  id: string
  label: string
  description: string
  size: string
  downloadMethod: string
  ready: boolean
}

interface Props {
  onComplete: () => void
}

export default function ModelDownload({ onComplete }: Props) {
  const [models, setModels] = useState<ModelEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [progress, setProgress] = useState<ProgressPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    window.doty.getSttModelList().then((list) => {
      setModels(list)
      if (list.length > 0) setSelected(list[0].id)
    })
    const unsub = window.doty.onModelProgress((p) => setProgress(p))
    return unsub
  }, [])

  async function startDownload() {
    if (!selected) return
    setStarted(true)
    setError(null)
    try {
      await window.doty.downloadModel(selected)
      onComplete()
    } catch (e) {
      setError(String(e))
      setStarted(false)
    }
  }

  const selectedModel = models.find((m) => m.id === selected)

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-surface px-8">
      <div className="fixed top-0 left-0 right-0 h-8" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      <div className="max-w-md w-full bg-panel border border-border rounded-2xl p-8 text-center">
        <div className="w-14 h-14 bg-accent/20 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>

        <h1 className="text-xl font-semibold mb-2">Speech Recognition Model</h1>
        <p className="text-sm text-gray-400 mb-5">
          Choose a model for offline speech-to-text. This only happens once — everything runs locally on your machine.
        </p>

        {!started && models.length > 0 && (
          <>
            <div className="space-y-2 mb-5 text-left">
              {models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelected(m.id)}
                  className={`w-full p-3 rounded-xl border text-left transition-colors ${
                    selected === m.id ? 'border-accent bg-accent/10' : 'border-border bg-surface hover:border-gray-500'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{m.label}</span>
                    <span className="text-xs text-gray-500">{m.size}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{m.description}</p>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={startDownload}
              disabled={!selected}
              className="w-full py-3 bg-accent hover:bg-accent/80 disabled:opacity-50 rounded-xl text-sm font-medium transition-colors"
            >
              {selectedModel?.downloadMethod === 'auto'
                ? `Select ${selectedModel.label}`
                : `Download ${selectedModel?.label ?? 'Model'}`}
            </button>
          </>
        )}

        {started && progress && (
          <div className="space-y-3">
            <div className="w-full bg-border rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span>{progress.percent}%</span>
              <span>
                {progress.downloadedMB} / {progress.totalMB} MB
              </span>
            </div>
            <p className="text-xs text-gray-500">Downloading {selectedModel?.label}...</p>
          </div>
        )}

        {started && !progress && (
          <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span>{selectedModel?.downloadMethod === 'auto' ? 'Setting up...' : 'Starting download...'}</span>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">{error}</div>
        )}
      </div>
    </div>
  )
}
