import { useEffect, useState } from 'react'

interface ModelEntry {
  id: string
  label: string
  description: string
  size: string
  streaming: boolean
  languages: string[]
  ready: boolean
}

interface Props {
  onComplete: () => void
  onSkip: () => void
}

export default function ModelDownload({ onComplete, onSkip }: Props) {
  const [models, setModels] = useState<ModelEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    window.doty.getSttModelList().then((list) => {
      setModels(list)
      if (list.length > 0) setSelected(list[0].id)
    })
  }, [])

  function startDownload() {
    if (!selected) return
    // Fire-and-forget: the main process downloads in the background and the app stays usable.
    window.doty.downloadModel(selected)
    onComplete()
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
          Choose a model for offline speech-to-text. It downloads once, runs locally, and keeps downloading in the
          background if you continue.
        </p>

        {models.length > 0 && (
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
              {`Download ${selectedModel?.label ?? 'Model'} in background`}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onSkip}
          className="mt-3 w-full py-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Skip for now — set it up later in Settings
        </button>
      </div>
    </div>
  )
}
