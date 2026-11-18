import { useCallback, useEffect, useRef, useState } from 'react'
import { MOODS, presetFor } from '../lib/lightsPreset'
import type { LightsState } from '../types'

const css = (rgb: [number, number, number]) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`

const label: React.CSSProperties = {
  fontSize: '11px',
  fontFamily: "'IBM Plex Mono', monospace",
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#9d8b66',
}

const small: React.CSSProperties = {
  fontSize: '12px',
  fontFamily: "'IBM Plex Mono', monospace",
  color: '#9d8b66',
}

/**
 * The lights of the session's Area. Absent from the DOM until a Home Assistant
 * is configured: a DM without one should never see a feature they do not own.
 */
export default function LightPanel({ session }: { session: string | null }) {
  const [state, setState] = useState<LightsState | null>(null)
  const [brightness, setBrightness] = useState(60)
  const sessionRef = useRef(session)
  sessionRef.current = session

  const adopt = useCallback((next: LightsState) => {
    setState(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    window.doty
      .lightsGetState(session)
      .then((next) => {
        if (!cancelled) adopt(next)
      })
      .catch(() => {})
    const unsubscribe = window.doty.onLightsState((next) => {
      if (!cancelled) adopt(next)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [session, adopt])

  if (!state?.configured) return null

  const connected = state.status === 'connected'
  const paused = state.pausedUntil !== null && state.pausedUntil > Date.now()
  const anyOn = state.lights.some((light) => light.on)

  return (
    <div
      className="shrink-0"
      style={{ background: '#0d0b08', border: '1px solid #3d2f1c', borderRadius: '3px', padding: '8px 12px' }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span style={label}>Lights</span>

        {state.areas.length > 0 ? (
          <select
            aria-label="Lighting area"
            value={state.areaId}
            onChange={(e) => window.doty.lightsSetArea(sessionRef.current, e.target.value).then(adopt)}
            style={{ ...small, background: '#100e0a', border: '1px solid #3d2f1c', padding: '2px 6px' }}
          >
            {state.areas.map((area) => (
              <option key={area.areaId} value={area.areaId}>
                {area.name}
              </option>
            ))}
          </select>
        ) : (
          <span style={small}>{connected ? 'no areas' : 'not connected'}</span>
        )}

        {connected && state.lights.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => window.doty.lightsSetPower(!anyOn).then(adopt)}
              aria-pressed={anyOn}
              style={{
                ...small,
                color: anyOn ? '#d9a441' : '#6d6a5f',
                border: '1px solid #3d2f1c',
                padding: '2px 8px',
              }}
            >
              {anyOn ? 'On' : 'Off'}
            </button>

            <input
              type="range"
              aria-label="Brightness"
              min={1}
              max={100}
              value={brightness}
              onChange={(e) => setBrightness(Number(e.target.value))}
              onMouseUp={() => window.doty.lightsSetBrightness(brightness).then(adopt)}
              onKeyUp={() => window.doty.lightsSetBrightness(brightness).then(adopt)}
              style={{ width: '90px', accentColor: '#d9a441' }}
            />

            {state.canColor && (
              <div className="flex items-center gap-1">
                {MOODS.map((mood) => (
                  <button
                    key={mood}
                    type="button"
                    title={mood}
                    aria-label={`Light ${mood}`}
                    onClick={() => window.doty.lightsSetMood(mood).then(adopt)}
                    style={{
                      width: '14px',
                      height: '14px',
                      background: css(presetFor(mood, 0.6).rgb),
                      border: state.mood === mood ? '1px solid #e4d6b4' : '1px solid #3d2f1c',
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {state.mood && (
          <span style={{ ...small, marginLeft: 'auto' }}>
            {state.mood} · {state.producer}
          </span>
        )}

        <button
          type="button"
          onClick={() => window.doty.lightsSetAuto(!state.auto).then(adopt)}
          aria-pressed={state.auto}
          style={{ ...small, color: state.auto ? '#d9a441' : '#6d6a5f' }}
        >
          auto {state.auto ? 'on' : 'off'}
        </button>
      </div>

      {paused && (
        <div className="flex items-center gap-2 mt-1">
          <span style={small}>Auto paused — you took the light.</span>
          <button
            type="button"
            onClick={() => window.doty.lightsResume().then(adopt)}
            style={{ ...small, color: '#d9a441', textDecoration: 'underline' }}
          >
            Resume
          </button>
        </div>
      )}
      {state.status === 'needs-reconnect' && (
        <p style={{ ...small, color: '#b46a4a', marginTop: '2px' }}>
          {state.error ?? 'Home Assistant unreachable'} — reconnect in Settings.
        </p>
      )}
    </div>
  )
}
