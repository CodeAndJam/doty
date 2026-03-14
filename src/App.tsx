import { useEffect, useState } from 'react'
import MainLayout from './components/MainLayout'
import ModelDownload from './components/ModelDownload'
import './types'

type AppState = 'loading' | 'download-model' | 'ready'

export default function App() {
  const [appState, setAppState] = useState<AppState>('loading')

  useEffect(() => {
    window.doty.modelStatus().then(({ ready }) => {
      setAppState(ready ? 'ready' : 'download-model')
    })

    const unsub = window.doty.onModelStatus(({ ready }) => {
      if (ready) setAppState('ready')
    })
    return unsub
  }, [])

  if (appState === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-surface">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (appState === 'download-model') {
    return <ModelDownload onComplete={() => setAppState('ready')} />
  }

  return <MainLayout />
}
