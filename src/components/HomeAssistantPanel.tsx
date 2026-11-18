import { useEffect, useState } from 'react'
import type { LightsState } from '../types'

const label: React.CSSProperties = {
  fontSize: '11px',
  fontFamily: "'IBM Plex Mono', monospace",
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#9d8b66',
  marginBottom: '6px',
}

const hint: React.CSSProperties = {
  fontSize: '13px',
  fontFamily: "'Crimson Text', serif",
  color: '#9d8b66',
  marginTop: '4px',
}

const field: React.CSSProperties = {
  fontSize: '13px',
  fontFamily: "'IBM Plex Mono', monospace",
  color: '#e4d6b4',
  background: '#100e0a',
  border: '1px solid #3d2f1c',
  padding: '6px 8px',
  width: '100%',
}

/**
 * The Home Assistant connection, next to Discord's. The Area itself is chosen
 * in the session, because it belongs to where the table sits, not to the app.
 */
export default function HomeAssistantPanel() {
  const [state, setState] = useState<LightsState | null>(null)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [found, setFound] = useState<Array<{ name: string; url: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.doty.lightsGetState(null).then((next) => {
      setState(next)
      setUrl(next.url)
    })
    return window.doty.onLightsState(setState)
  }, [])

  if (!state) return null

  async function connect() {
    setBusy(true)
    setError('')
    try {
      const next = await window.doty.lightsConfigure({ url, token: token || undefined })
      if (next.status === 'needs-reconnect')
        setError(next.error ?? 'Home Assistant did not accept that address and token.')
      else setToken('')
      setState(next)
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setState(await window.doty.lightsClear())
    setUrl('')
  }

  return (
    <div>
      <div style={label}>Home Assistant</div>

      {state.configured ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", color: '#e4d6b4' }}>
              {state.url}
            </span>
            <span
              style={{
                fontSize: '11px',
                fontFamily: "'IBM Plex Mono', monospace",
                color: state.status === 'connected' ? '#6dbf95' : '#b46a4a',
              }}
            >
              {state.status === 'connected'
                ? 'connected'
                : state.status === 'connecting'
                  ? 'connecting'
                  : 'needs reconnect'}
            </span>
            <button
              type="button"
              onClick={disconnect}
              style={{
                fontSize: '12px',
                fontFamily: "'IBM Plex Mono', monospace",
                color: '#9d8b66',
                marginLeft: 'auto',
              }}
            >
              Disconnect
            </button>
          </div>
          <p style={hint}>
            The room is chosen in the session, next to the lights. Doty only talks to this instance, on your own
            network.
          </p>
          {state.status === 'needs-reconnect' && (
            <div style={{ marginTop: '8px' }}>
              <input
                type="password"
                aria-label="Home Assistant token"
                placeholder="New long-lived access token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                style={field}
              />
              <button
                type="button"
                disabled={busy || !token}
                onClick={connect}
                style={{
                  fontSize: '12px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: '#d9a441',
                  marginTop: '6px',
                }}
              >
                Reconnect
              </button>
            </div>
          )}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              aria-label="Home Assistant address"
              placeholder="http://homeassistant.local:8123"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={field}
            />
            <button
              type="button"
              onClick={async () => {
                setBusy(true)
                setFound(await window.doty.lightsDiscover().catch(() => []))
                setBusy(false)
              }}
              style={{
                fontSize: '12px',
                fontFamily: "'IBM Plex Mono', monospace",
                color: '#9d8b66',
                whiteSpace: 'nowrap',
              }}
            >
              Find
            </button>
          </div>
          {found.length > 0 && (
            <div className="flex gap-2 flex-wrap mt-2">
              {found.map((entry) => (
                <button
                  key={entry.url}
                  type="button"
                  onClick={() => setUrl(entry.url)}
                  style={{ fontSize: '12px', fontFamily: "'IBM Plex Mono', monospace", color: '#d9a441' }}
                >
                  {entry.name} · {entry.url}
                </button>
              ))}
            </div>
          )}
          <input
            type="password"
            aria-label="Home Assistant token"
            placeholder="Long-lived access token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ ...field, marginTop: '6px' }}
          />
          <button
            type="button"
            disabled={busy || !url || !token}
            onClick={connect}
            style={{ fontSize: '12px', fontFamily: "'IBM Plex Mono', monospace", color: '#d9a441', marginTop: '6px' }}
          >
            Connect
          </button>
          {error && <p style={{ ...hint, color: '#b46a4a' }}>{error}</p>}
          <p style={hint}>
            Create a long-lived token in Home Assistant under your profile, then paste it here. Doty keeps it encrypted
            and talks only to this instance on your network.
          </p>
        </div>
      )}
    </div>
  )
}
