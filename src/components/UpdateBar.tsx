import { useEffect, useState } from 'react'
import type { UpdateState } from '../types'

/**
 * A slim bar at the very bottom of the window: a newer release is offered, never
 * forced. Dismissing it hides the bar until the next launch.
 */
export default function UpdateBar() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    window.doty
      .updateState()
      .then(setState)
      .catch(() => {})
    return window.doty.onUpdateState(setState)
  }, [])

  if (dismissed || state.status === 'idle') return null

  const text =
    state.status === 'available'
      ? `Doty ${state.version} is available · ${state.sizeMB} MB`
      : state.status === 'downloading'
        ? `Downloading Doty ${state.version} · ${state.percent}%`
        : state.status === 'installing'
          ? `Restarting into Doty ${state.version}…`
          : `Update failed — ${state.error}`

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="update-bar"
      className="shrink-0 flex items-center justify-center gap-3 px-6 py-1.5"
      style={{
        background: '#100e0a',
        borderTop: '1px solid #3d2f1c',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: '11px',
        color: state.status === 'error' ? '#e08a6f' : '#d9a441',
      }}
    >
      <span>{text}</span>
      {(state.status === 'available' || state.status === 'error') && (
        <button
          type="button"
          onClick={() => window.doty.updateInstall().catch(() => {})}
          className="px-2 py-0.5 transition-opacity hover:opacity-80"
          style={{ border: '1px solid rgba(217,164,65,0.5)', color: '#e4d6b4' }}
        >
          {state.status === 'error' ? 'Try again' : 'Update & restart'}
        </button>
      )}
      {(state.status === 'available' || state.status === 'error') && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="opacity-70 transition-opacity hover:opacity-100"
          style={{ color: '#9d8b66' }}
        >
          Later
        </button>
      )}
    </div>
  )
}
