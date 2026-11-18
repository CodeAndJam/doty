import { useCallback, useEffect, useRef, useState } from 'react'
import { MOODS, presetFor } from '../lib/lightsPreset'
import type { LightPatch, LightsState } from '../types'

const css = (rgb: [number, number, number]) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`

const toHex = (rgb: [number, number, number]) =>
  `#${rgb
    .map((part) =>
      Math.max(0, Math.min(255, Math.round(part)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

const fromHex = (hex: string): [number, number, number] => {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

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

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '3px 0',
  borderTop: '1px solid #241d12',
}

/**
 * The lights of the session's Area. Absent from the DOM until a Home Assistant
 * is configured: a DM without one should never see a feature they do not own.
 */
export default function LightPanel({ session }: { session: string | null }) {
  const [state, setState] = useState<LightsState | null>(null)
  const [brightness, setBrightness] = useState(60)
  // Slider and picker values while the DM is still dragging.
  const [levels, setLevels] = useState<Record<string, number>>({})
  const [colours, setColours] = useState<Record<string, string>>({})
  const sessionRef = useRef(session)
  sessionRef.current = session

  const adopt = useCallback((next: LightsState) => {
    setState(next)
    // Home Assistant is the truth: drop drafts once it has answered.
    setLevels({})
    setColours({})
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

  const setLight = (entityId: string, patch: LightPatch) => window.doty.lightsSetLight(entityId, patch).then(adopt)

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
          <span style={small}>{connected ? 'Home Assistant reported no Areas for this token' : 'not connected'}</span>
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
              {anyOn ? 'All off' : 'All on'}
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

      {connected && state.lights.length > 0 && (
        <div className="mt-1 max-h-40 overflow-y-auto">
          {state.lights.map((light) => {
            const level = levels[light.entityId] ?? light.brightnessPct ?? 60
            const colour = colours[light.entityId] ?? toHex(light.rgb ?? [255, 235, 200])
            return (
              <div key={light.entityId} style={row}>
                <span style={{ ...small, color: '#e4d6b4', minWidth: '90px' }}>{light.name}</span>

                <button
                  type="button"
                  onClick={() => setLight(light.entityId, { on: !light.on })}
                  aria-pressed={light.on}
                  aria-label={`${light.name} on`}
                  style={{
                    ...small,
                    color: light.on ? '#d9a441' : '#6d6a5f',
                    border: '1px solid #3d2f1c',
                    padding: '1px 8px',
                    minWidth: '38px',
                  }}
                >
                  {light.on ? 'On' : 'Off'}
                </button>

                <input
                  type="range"
                  aria-label={`${light.name} brightness`}
                  min={1}
                  max={100}
                  value={level}
                  onChange={(e) => setLevels((prev) => ({ ...prev, [light.entityId]: Number(e.target.value) }))}
                  onMouseUp={() => setLight(light.entityId, { on: true, brightnessPct: level })}
                  onKeyUp={() => setLight(light.entityId, { on: true, brightnessPct: level })}
                  style={{ width: '80px', accentColor: '#d9a441' }}
                />
                <span style={{ ...small, minWidth: '30px', textAlign: 'right' }}>{level}%</span>

                {light.canColor && (
                  <input
                    type="color"
                    aria-label={`${light.name} colour`}
                    value={colour}
                    onChange={(e) => setColours((prev) => ({ ...prev, [light.entityId]: e.target.value }))}
                    onBlur={() => setLight(light.entityId, { on: true, rgb: fromHex(colour) })}
                    style={{ width: '24px', height: '18px', background: 'transparent', border: '1px solid #3d2f1c' }}
                  />
                )}

                {light.effectList.length > 0 && (
                  <select
                    aria-label={`${light.name} effect`}
                    value={light.effect ?? ''}
                    onChange={(e) => {
                      // The placeholder is not an effect; switching back to it
                      // would send an empty name Home Assistant rejects.
                      if (e.target.value) setLight(light.entityId, { on: true, effect: e.target.value })
                    }}
                    style={{ ...small, background: '#100e0a', border: '1px solid #3d2f1c', padding: '1px 4px' }}
                  >
                    <option value="">effect…</option>
                    {light.effectList.map((effect) => (
                      <option key={effect} value={effect}>
                        {effect}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!connected && state.configured && (
        <p style={{ ...small, marginTop: '2px', color: state.status === 'connecting' ? '#9d8b66' : '#b46a4a' }}>
          {state.status === 'connecting' && 'Connecting to Home Assistant…'}
          {state.status === 'needs-reconnect' && `${state.error ?? 'Home Assistant unreachable'} — fix it in Settings.`}
          {state.status === 'off' && 'Not connected — add an address and token in Settings.'}
        </p>
      )}

      {connected && state.areaId && state.lights.length === 0 && (
        <p style={{ ...small, marginTop: '2px' }}>No lights in this Area.</p>
      )}

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
