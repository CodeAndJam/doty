import { useEffect, useState } from 'react'
import type { DiscordGuild, DiscordState, DiscordVoiceChannel } from '../types'

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#080705',
  border: '1px solid #2e2416',
  padding: '8px 12px',
  fontSize: '15px',
  color: '#c8b07a',
  fontFamily: "'Crimson Text', serif",
  outline: 'none',
}

const btnStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: 'rgba(200,146,42,0.08)',
  border: '1px solid rgba(200,146,42,0.3)',
  color: '#c8922a',
  fontSize: '16px',
  fontFamily: "'Cinzel', serif",
  letterSpacing: '0.1em',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'all 0.2s',
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "'Cinzel', serif",
        fontSize: '15px',
        letterSpacing: '0.25em',
        color: '#6b4e15',
        textTransform: 'uppercase',
        display: 'block',
        marginBottom: '8px',
      }}
    >
      {children}
    </span>
  )
}

function StatusDot({ color, shadow }: { color: string; shadow: string }) {
  return (
    <div
      style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        flexShrink: 0,
        background: color,
        boxShadow: shadow,
      }}
    />
  )
}

export default function DiscordPanel() {
  const [state, setState] = useState<DiscordState>({
    status: 'disconnected',
    voiceStatus: 'idle',
    currentGuildId: null,
    currentChannelId: null,
    error: null,
  })
  const [hasToken, setHasToken] = useState(false)
  const [tokenInput, setTokenInput] = useState('')
  const [showTokenInput, setShowTokenInput] = useState(false)
  const [guilds, setGuilds] = useState<DiscordGuild[]>([])
  const [channels, setChannels] = useState<DiscordVoiceChannel[]>([])
  const [selectedGuild, setSelectedGuild] = useState('')
  const [selectedChannel, setSelectedChannel] = useState('')
  const [volume, setVolume] = useState(1)
  const [connecting, setConnecting] = useState(false)
  const [autoConnect, setAutoConnect] = useState(false)

  // Load initial state
  useEffect(() => {
    window.doty.discordGetState().then(setState)
    window.doty.discordHasToken().then(setHasToken)
    window.doty.discordGetVolume().then(setVolume)
    window.doty.discordGetAutoConnect().then(setAutoConnect)

    const unsub = window.doty.onDiscordState((s) => {
      setState(s)
    })
    return unsub
  }, [])

  // Fetch guilds when connected
  useEffect(() => {
    if (state.status === 'ready') {
      window.doty.discordGetGuilds().then((g) => {
        setGuilds(g)
        if (g.length === 1) setSelectedGuild(g[0].id)
      })
    } else {
      setGuilds([])
      setChannels([])
      setSelectedGuild('')
      setSelectedChannel('')
    }
  }, [state.status])

  // Fetch channels when guild selected
  useEffect(() => {
    if (selectedGuild && state.status === 'ready') {
      window.doty.discordGetVoiceChannels(selectedGuild).then((ch) => {
        setChannels(ch)
        if (ch.length === 1) setSelectedChannel(ch[0].id)
      })
    } else {
      setChannels([])
      setSelectedChannel('')
    }
  }, [selectedGuild, state.status])

  async function handleConnect() {
    setConnecting(true)
    try {
      const token = tokenInput.trim() || undefined
      const result = await window.doty.discordConnect(token)
      if (result.ok) {
        setHasToken(true)
        setTokenInput('')
        setShowTokenInput(false)
      }
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    await window.doty.discordDisconnect()
  }

  async function handleJoin() {
    if (!selectedGuild || !selectedChannel) return
    await window.doty.discordJoinChannel(selectedGuild, selectedChannel)
  }

  async function handleLeave() {
    await window.doty.discordLeaveChannel()
  }

  function handleVolumeChange(v: number) {
    setVolume(v)
    window.doty.discordSetVolume(v)
  }

  async function handleClearToken() {
    await window.doty.discordClearToken()
    setHasToken(false)
    setTokenInput('')
  }

  const isConnected = state.status === 'ready'
  const isInVoice = state.voiceStatus === 'connected' || state.voiceStatus === 'playing'

  const statusColor = isConnected
    ? '#4a8a6a'
    : state.status === 'error'
      ? '#ef4444'
      : state.status === 'connecting'
        ? '#c8922a'
        : '#3a2e1a'
  const statusShadow = isConnected
    ? '0 0 6px rgba(74,138,106,0.7)'
    : state.status === 'error'
      ? '0 0 6px rgba(239,68,68,0.7)'
      : '0 0 6px rgba(200,146,42,0.5)'
  const statusLabel = isConnected
    ? 'Connected'
    : state.status === 'connecting'
      ? 'Connecting...'
      : state.status === 'error'
        ? 'Error'
        : 'Disconnected'

  const voiceColor = isInVoice ? '#4a8a6a' : state.voiceStatus === 'joining' ? '#c8922a' : '#3a2e1a'
  const voiceShadow = isInVoice ? '0 0 6px rgba(74,138,106,0.7)' : '0 0 6px rgba(200,146,42,0.5)'

  return (
    <div>
      {/* Connection status */}
      <div className="mb-4">
        <Label>Discord Conduit</Label>
        <div
          className="flex items-center gap-3 mb-3"
          style={{ background: '#080705', border: '1px solid #2e2416', padding: '10px 12px' }}
        >
          <StatusDot color={statusColor} shadow={statusShadow} />
          <div className="flex-1 min-w-0">
            <p style={{ fontSize: '15px', color: '#c8b07a', fontFamily: "'Crimson Text', serif" }}>Bot Gateway</p>
            <p style={{ fontSize: '13px', color: '#3a2e1a', fontFamily: 'monospace' }}>{statusLabel}</p>
          </div>
          {!isConnected ? (
            <button
              onClick={hasToken && !showTokenInput ? handleConnect : () => setShowTokenInput(true)}
              disabled={connecting}
              style={{
                ...btnStyle,
                opacity: connecting ? 0.5 : 1,
                cursor: connecting ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                padding: '5px 10px',
              }}
              onMouseEnter={(e) => {
                if (!connecting) e.currentTarget.style.background = 'rgba(200,146,42,0.15)'
              }}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}
            >
              {connecting ? 'Connecting...' : hasToken ? 'Connect' : 'Set Token'}
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              style={{
                ...btnStyle,
                fontSize: '13px',
                padding: '5px 10px',
                borderColor: 'rgba(239,68,68,0.3)',
                color: '#ef4444',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}
            >
              Disconnect
            </button>
          )}
        </div>

        {/* Error display */}
        {state.error && (
          <p style={{ fontSize: '13px', color: '#ef4444', fontFamily: 'monospace', marginBottom: '8px' }}>
            {state.error}
          </p>
        )}

        {/* Token input */}
        {(showTokenInput || (!hasToken && !isConnected)) && !isConnected && (
          <div className="mb-3">
            <div className="flex gap-2">
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Bot token..."
                style={inputStyle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tokenInput.trim()) handleConnect()
                }}
              />
              <button
                onClick={handleConnect}
                disabled={!tokenInput.trim() || connecting}
                style={{ ...btnStyle, opacity: !tokenInput.trim() || connecting ? 0.5 : 1 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.15)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}
              >
                Connect
              </button>
            </div>
            <p style={{ fontSize: '12px', color: '#3a2e1a', marginTop: '4px', fontFamily: "'Crimson Text', serif" }}>
              Token is encrypted and stored locally
            </p>
          </div>
        )}

        {/* Clear token */}
        {hasToken && !isConnected && !showTokenInput && (
          <button
            onClick={handleClearToken}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#3a2e1a',
              fontSize: '12px',
              fontFamily: 'monospace',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#c8922a')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#3a2e1a')}
          >
            clear saved token
          </button>
        )}

        {/* Auto-connect toggle */}
        {hasToken && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              color: '#6b4e15',
              fontFamily: "'Crimson Text', serif",
            }}
          >
            <input
              type="checkbox"
              checked={autoConnect}
              onChange={(e) => {
                setAutoConnect(e.target.checked)
                window.doty.discordSetAutoConnect(e.target.checked)
              }}
              style={{ accentColor: '#c8922a' }}
            />
            Auto-connect to last channel on startup
          </label>
        )}
      </div>

      {/* Server & Channel selection — only when connected */}
      {isConnected && (
        <div className="mb-4">
          <Label>Voice Channel</Label>

          {/* Voice status */}
          {isInVoice && (
            <div
              className="flex items-center gap-3 mb-3"
              style={{ background: '#080705', border: '1px solid #2e2416', padding: '10px 12px' }}
            >
              <StatusDot color={voiceColor} shadow={voiceShadow} />
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: '15px', color: '#c8b07a', fontFamily: "'Crimson Text', serif" }}>
                  {state.voiceStatus === 'playing' ? 'Streaming' : 'In Channel'}
                </p>
              </div>
              <button
                onClick={handleLeave}
                style={{
                  ...btnStyle,
                  fontSize: '13px',
                  padding: '5px 10px',
                  borderColor: 'rgba(239,68,68,0.3)',
                  color: '#ef4444',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}
              >
                Leave
              </button>
            </div>
          )}

          {/* Guild picker */}
          {!isInVoice &&
            (guilds.length === 0 ? (
              <p
                style={{
                  fontSize: '13px',
                  color: '#3a2e1a',
                  fontFamily: "'Crimson Text', serif",
                  marginBottom: '8px',
                }}
              >
                Bot is not in any servers. Invite it first.
              </p>
            ) : (
              <>
                <select
                  value={selectedGuild}
                  onChange={(e) => setSelectedGuild(e.target.value)}
                  style={{ ...inputStyle, marginBottom: '8px' }}
                >
                  <option value="">Select a server...</option>
                  {guilds.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>

                {/* Channel picker */}
                {selectedGuild && (
                  <div className="flex gap-2">
                    <select
                      value={selectedChannel}
                      onChange={(e) => setSelectedChannel(e.target.value)}
                      style={{ ...inputStyle, flex: 1 }}
                    >
                      <option value="">Select a channel...</option>
                      {channels.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          {ch.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleJoin}
                      disabled={!selectedChannel}
                      style={{ ...btnStyle, opacity: selectedChannel ? 1 : 0.5 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.15)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}
                    >
                      Join
                    </button>
                  </div>
                )}
              </>
            ))}
        </div>
      )}

      {/* Discord volume — only when in voice */}
      {isInVoice && (
        <div className="mb-4">
          <Label>Discord Volume</Label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#c8922a' }}
            />
            <span
              style={{
                fontSize: '15px',
                color: '#c8b07a',
                fontFamily: 'monospace',
                minWidth: '36px',
                textAlign: 'right',
              }}
            >
              {Math.round(volume * 100)}%
            </span>
          </div>
          <p style={{ fontSize: '14px', color: '#3a2e1a', marginTop: '4px', fontFamily: "'Crimson Text', serif" }}>
            Independent from local playback volume
          </p>
        </div>
      )}
    </div>
  )
}
