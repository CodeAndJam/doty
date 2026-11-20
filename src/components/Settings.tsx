import { useCallback, useEffect, useRef, useState } from 'react'
import { useCrossfade } from '../hooks/useCrossfade'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { confidenceLabel } from '../lib/autopilot'
import { indexSummary } from '../lib/indexStatus'
import type { DebugState, IndexProgress, ScanProgress, UpdateState } from '../types'
import DiscordPanel from './DiscordPanel'
import HomeAssistantPanel from './HomeAssistantPanel'

const LANGUAGE_LABELS: Record<string, string> = {
  pt: 'Português',
  'pt-PT': 'Português (Portugal)',
  'pt-BR': 'Português (Brasil)',
  en: 'English',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  es: 'Español',
  'es-ES': 'Español (España)',
  'es-US': 'Español (Latinoamérica)',
  fr: 'Français',
  'fr-FR': 'Français (France)',
  'fr-CA': 'Français (Canada)',
  de: 'Deutsch',
  'de-DE': 'Deutsch (Deutschland)',
  it: 'Italiano',
  'it-IT': 'Italiano (Italia)',
  nl: 'Nederlands',
  'nl-NL': 'Nederlands (Nederland)',
  ru: 'Русский',
  'ru-RU': 'Русский (Россия)',
  zh: '中文',
  'zh-CN': '中文 (简体)',
  ja: '日本語',
  'ja-JP': '日本語 (日本)',
  ko: '한국어',
  'ko-KR': '한국어 (대한민국)',
  pl: 'Polski',
  'pl-PL': 'Polski (Polska)',
  ro: 'Română',
  'ro-RO': 'Română (România)',
  sv: 'Svenska',
  'sv-SE': 'Svenska (Sverige)',
}

interface Props {
  onClose: () => void
  onFolderChange: (folder: string) => void
  onMicChange: (deviceId: string | null) => void
  onSpeakerChange: (deviceId: string | null) => void
  micDeviceId?: string
  speakerDeviceId?: string
  rankerStatus: 'loading' | 'ready' | 'error'
  recommendCount: number
  onRecommendCountChange: (count: number) => void
  /** Which group to open on; the transcript failures open Transcription. */
  initialSection?: SectionId
}

interface AudioDevice {
  deviceId: string
  label: string
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "'Cinzel', serif",
        fontSize: '15px',
        letterSpacing: '0.25em',
        color: '#a5813f',
        textTransform: 'uppercase' as const,
        display: 'block',
        marginBottom: '8px',
      }}
    >
      {children}
    </span>
  )
}

export type SectionId = 'audio' | 'library' | 'transcription' | 'director' | 'updates' | 'advanced'

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: 'audio', label: 'Audio' },
  { id: 'library', label: 'Library' },
  { id: 'transcription', label: 'Transcription' },
  { id: 'director', label: 'Director' },
  { id: 'updates', label: 'Updates' },
  { id: 'advanced', label: 'Advanced' },
]

export default function Settings({
  onClose,
  onFolderChange,
  onMicChange,
  onSpeakerChange,
  micDeviceId,
  speakerDeviceId,
  rankerStatus,
  recommendCount,
  onRecommendCountChange,
  initialSection = 'library',
}: Props) {
  const [folder, setFolder] = useState('')
  const [trackCount, setTrackCount] = useState(0)
  const [sttReady, setSttReady] = useState(false)
  const [transcriptFolder, setTranscriptFolder] = useState('')
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
  const [scanDone, setScanDone] = useState(false)
  const [lastScanTime, setLastScanTime] = useState<string | null>(null)
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([])
  const [selectedMic, setSelectedMic] = useState<string>(micDeviceId ?? '')
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>(speakerDeviceId ?? '')
  const [micPermissionDenied, setMicPermissionDenied] = useState(false)
  const [sfxFolder, setSfxFolder] = useState('')
  const [sfxRecommendCount, setSfxRecommendCount] = useState(5)
  const [autopilotThreshold, setAutopilotThreshold] = useState(0.9)
  const [autopilotCrossfade, setAutopilotCrossfade] = useState(3)
  const [autopilotEnabled, setAutopilotEnabled] = useState(false)
  const [autopilotMusic, setAutopilotMusic] = useState(true)
  const [autopilotSfx, setAutopilotSfx] = useState(true)
  const [sttModel, setSttModel] = useState('parakeet')
  const [sttLanguage, setSttLanguage] = useState('auto')
  const [indexStatus, setIndexStatus] = useState<IndexProgress | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' })
  const [updateNotice, setUpdateNotice] = useState<string | null>(null)
  const [modelMessage, setModelMessage] = useState<string | null>(null)
  const [section, setSection] = useState<SectionId>(initialSection)
  const [debugState, setDebugState] = useState<DebugState | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<Element | null>(null)

  const refreshDebug = useCallback(async () => {
    setDebugState(await window.doty.debugGetState())
  }, [])

  // Read the machine's state when the group is opened, not on every render.
  useEffect(() => {
    if (section === 'advanced') void refreshDebug()
  }, [section, refreshDebug])

  // A modal should take focus and give it back; otherwise the DM tabs into the
  // player behind the backdrop.
  useEffect(() => {
    openerRef.current = document.activeElement
    dialogRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
    return () => {
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus()
    }
  }, [])

  useFocusTrap(dialogRef)

  /** One rail: a column on a wide window, a wrapped tab row on a narrow one. */
  const settingsNav = () => (
    <div
      role="tablist"
      aria-label="Settings sections"
      aria-orientation="vertical"
      className="flex md:flex-col flex-wrap gap-1 shrink-0 p-4 md:w-44 md:border-r"
      style={{ borderColor: '#3d2f1c' }}
      onKeyDown={(e) => {
        const at = SECTIONS.findIndex((item) => item.id === section)
        const step =
          e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
        const target =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? SECTIONS.length - 1
              : step
                ? (at + step + SECTIONS.length) % SECTIONS.length
                : -1
        if (target < 0) return
        e.preventDefault()
        setSection(SECTIONS[target].id)
        document.getElementById(`settings-tab-${SECTIONS[target].id}`)?.focus()
      }}
    >
      {SECTIONS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`settings-tab-${item.id}`}
          aria-selected={section === item.id}
          aria-controls={`settings-panel-${item.id}`}
          tabIndex={section === item.id ? 0 : -1}
          data-testid={`settings-section-${item.id}`}
          onClick={() => setSection(item.id)}
          className="text-left px-2 py-1.5 transition-colors"
          style={{
            fontFamily: "'Cinzel', serif",
            fontSize: '12px',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: section === item.id ? '#d9a441' : '#a5813f',
            background: section === item.id ? 'rgba(200,146,42,0.08)' : 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
  const [_sttModelStatus, setSttModelStatus] = useState<Record<string, boolean>>({})
  const [sttModelList, setSttModelList] = useState<
    Array<{
      id: string
      label: string
      description: string
      size: string
      streaming: boolean
      languages: string[]
      ready: boolean
    }>
  >([])
  const [whisperDownloading, setWhisperDownloading] = useState<string | null>(null)
  const [whisperProgress, setWhisperProgress] = useState(0)
  const [whisperDownloadError, setWhisperDownloadError] = useState<string | null>(null)
  const [rankerInstalled, setRankerInstalled] = useState<boolean | null>(null)
  const [rankerLanguageCovered, setRankerLanguageCovered] = useState(true)
  const [rankerProgress, setRankerProgress] = useState<number | null>(null)
  const [rankerDownloadError, setRankerDownloadError] = useState<string | null>(null)
  const { crossfadeMs, setCrossfadeMs } = useCrossfade()

  const refreshTrackCount = useCallback(async () => {
    const files = await window.doty.listMusic()
    setTrackCount(files.length)
  }, [])

  useEffect(() => {
    window.doty.getMusicFolder().then((f) => {
      setFolder(f)
      if (f) refreshTrackCount()
    })
    window.doty.modelStatus().then(({ ready }) => setSttReady(ready))
    window.doty.getSttDownloadState().then(({ downloading, error }) => {
      if (downloading) {
        setWhisperDownloading(downloading.modelId)
        setWhisperProgress(downloading.percent)
      }
      if (error) setWhisperDownloadError(error.error)
    })
    window.doty.getTranscriptFolder().then(setTranscriptFolder)
    window.doty.rankerStatus().then((s) => {
      setRankerInstalled(s.cached)
      setRankerLanguageCovered(s.languageCovered)
      // A download may already be running from launch; the label must say so
      // rather than "failed" until the first progress event arrives.
      if (s.downloading) setRankerProgress((prev) => prev ?? 0)
    })
    window.doty
      .appVersion()
      .then(setAppVersion)
      .catch(() => {})
    window.doty
      .updateState()
      .then(setUpdate)
      .catch(() => {})
    const unsubUpdate = window.doty.onUpdateState(setUpdate)
    window.doty.getSfxFolder().then(setSfxFolder)
    window.doty.getSfxRecommendationCount().then(setSfxRecommendCount)
    window.doty.getSttModel().then(setSttModel)
    window.doty.getSttLanguage().then(setSttLanguage)
    window.doty.getSttModelStatus().then(setSttModelStatus)
    // The list is static, but an early/failed IPC used to leave the pane empty
    // with no download path. Retry a few times before giving up.
    const cancelled = false
    let tries = 0
    const loadModels = () => {
      window.doty
        .getSttModelList()
        .then((list) => {
          if (cancelled) return
          setSttModelList(list)
          if (list.length === 0 && ++tries < 4) setTimeout(loadModels, 500)
        })
        .catch(() => {
          if (!cancelled && ++tries < 4) setTimeout(loadModels, 500)
        })
    }
    loadModels()
    // Subscribe first, then fetch: an event that lands while the fetch is in
    // flight must not be overwritten by the older snapshot.
    let sawEvent = false
    const unsubIndex = window.doty.onEmbeddingProgress((status) => {
      sawEvent = true
      setIndexStatus(status)
    })
    window.doty
      .embeddingStatus()
      .then((status) => {
        if (!sawEvent) setIndexStatus(status)
      })
      .catch(() => {})

    window.doty.getAutopilotConfig().then((cfg) => {
      setAutopilotThreshold(cfg.confidenceThreshold)
      setAutopilotCrossfade(cfg.crossfadeDuration)
      setAutopilotEnabled(cfg.enabled)
      setAutopilotMusic(cfg.musicEnabled)
      setAutopilotSfx(cfg.sfxEnabled)
    })

    const unsubProgress = window.doty.onScanProgress((p) => {
      setScanProgress(p)
      setScanDone(false)
    })
    const unsubComplete = window.doty.onScanComplete(() => {
      setScanProgress(null)
      setScanDone(true)
      setLastScanTime(new Date().toLocaleTimeString())
    })
    const unsubWhisper = window.doty.onModelProgress((p) => {
      setWhisperProgress(p.percent)
      if (p.percent >= 100) {
        setWhisperDownloading(null)
        setWhisperProgress(0)
        window.doty.getSttModelStatus().then(setSttModelStatus)
        window.doty.getSttModelList().then(setSttModelList)
      }
    })
    const unsubModelStatus = window.doty.onModelStatus(({ ready }) => setSttReady(ready))
    const unsubModelError = window.doty.onModelDownloadError(({ error }) => {
      setWhisperDownloadError(error)
      setWhisperDownloading(null)
    })
    const unsubModelCancelled = window.doty.onModelDownloadCancelled(() => {
      setWhisperDownloading(null)
      setWhisperProgress(0)
      setWhisperDownloadError(null)
    })
    // The worker persists the effective language on ready (e.g. a model that
    // maps `pt` to `pt-PT`); refresh so Settings reflects reality.
    const unsubSttStatus = window.doty.onSttStatus((status) => {
      if (status === 'ready') window.doty.getSttLanguage().then(setSttLanguage)
    })

    const unsubRanker = window.doty.onRankerDownloadProgress((p) => {
      setRankerProgress(p.status === 'downloading' ? p.percent : null)
      if (p.status === 'done') {
        setRankerInstalled(true)
        setRankerDownloadError(null)
      }
      if (p.status === 'error') setRankerDownloadError(p.reason ?? 'download failed')
    })

    window.doty.micCheckPermission().then((status: string) => {
      setMicPermissionDenied(status === 'denied' || status === 'restricted')
    })

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        // Only needed to unlock device labels — release the mic immediately.
        for (const track of stream.getTracks()) track.stop()
        return navigator.mediaDevices.enumerateDevices()
      })
      .then((devices) => {
        const inputs = devices
          .filter((d) => d.kind === 'audioinput')
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
        setAudioDevices(inputs)
        const outputs = devices
          .filter((d) => d.kind === 'audiooutput')
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Speaker ${i + 1}` }))
        setOutputDevices(outputs)
      })
      .catch(() => {})

    return () => {
      unsubIndex()
      unsubUpdate()
      unsubProgress()
      unsubComplete()
      unsubWhisper()
      unsubModelStatus()
      unsubModelError()
      unsubModelCancelled()
      unsubSttStatus()
      unsubRanker()
    }
  }, [refreshTrackCount])

  // Escape key to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

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

  function handleMicChange(deviceId: string) {
    setSelectedMic(deviceId)
    onMicChange(deviceId || null)
  }

  function handleSpeakerChange(deviceId: string) {
    setSelectedSpeaker(deviceId)
    onSpeakerChange(deviceId || null)
  }

  async function toggleDebug() {
    setDebugState(await window.doty.debugSetEnabled(!(debugState?.enabled ?? false)))
  }

  function copyDiagnostics() {
    if (debugState?.diagnostics) navigator.clipboard.writeText(debugState.diagnostics)
  }

  async function refreshModels() {
    window.doty.getSttModelList().then(setSttModelList)
    window.doty.getSttModel().then(setSttModel)
    window.doty.getSttModelStatus().then(setSttModelStatus)
    window.doty.modelStatus().then(({ ready }) => setSttReady(ready))
    window.doty.rankerStatus().then((s) => {
      setRankerInstalled(s.cached)
      setRankerLanguageCovered(s.languageCovered)
    })
    window.doty.embeddingStatus().then(setIndexStatus)
  }

  async function deleteModel(kind: 'stt' | 'ranker' | 'embedder', id?: string) {
    setModelMessage(null)
    const result = await window.doty.deleteModel(kind, id).catch(() => ({ ok: false, reason: 'delete failed' }))
    if (!result.ok && result.reason !== 'cancelled') setModelMessage(result.reason ?? 'Delete failed')
    if (result.ok) await refreshModels()
  }

  async function checkNow() {
    setUpdateNotice(null)
    const result = await window.doty.updateCheck().catch((e) => ({
      ok: false,
      status: 'error' as const,
      error: String(e),
    }))
    if (result.status === 'current') setUpdateNotice(`Doty ${appVersion || ''} is up to date`.trim())
    else if (result.status === 'error') setUpdateNotice(result.error ?? 'Could not check for updates')
  }

  const updateText =
    update.status === 'available'
      ? `Doty ${update.version} is available (${update.sizeMB} MB)`
      : update.status === 'downloading'
        ? `Downloading Doty ${update.version} · ${update.percent}%`
        : update.status === 'installing'
          ? `Restarting into Doty ${update.version}…`
          : update.status === 'error'
            ? `Update failed — ${update.error}`
            : 'Check GitHub for a newer release.'

  const scanPercent =
    scanProgress && scanProgress.total > 0 ? Math.round((scanProgress.done / scanProgress.total) * 100) : 0

  const rankerIsReady = rankerStatus === 'ready'
  const rankerIsError = rankerStatus === 'error'

  const activeSttLanguages = sttModelList.find((m) => m.id === sttModel)?.languages ?? []
  const sttLanguageOptions =
    sttLanguage !== 'auto' && !activeSttLanguages.includes(sttLanguage)
      ? [sttLanguage, ...activeSttLanguages]
      : activeSttLanguages

  const rankerDotColor = rankerIsReady
    ? '#6dbf95'
    : rankerProgress !== null
      ? '#d9a441'
      : rankerIsError
        ? '#ef4444'
        : '#d9a441'
  const rankerDotShadow = rankerIsReady
    ? '0 0 6px rgba(74,138,106,0.7)'
    : rankerProgress !== null
      ? '0 0 6px rgba(200,146,42,0.7)'
      : rankerIsError
        ? '0 0 6px rgba(239,68,68,0.7)'
        : '0 0 6px rgba(200,146,42,0.7)'
  const rankerLabel = rankerIsReady
    ? 'Attuned'
    : rankerProgress !== null
      ? `Downloading${rankerProgress > 0 ? ` ${rankerProgress}%` : '…'}`
      : rankerIsError
        ? 'Failed — using heuristic fallback'
        : 'Summoning...'

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: '#080705',
    border: '1px solid #3d2f1c',
    padding: '8px 12px',
    fontSize: '15px',
    color: '#e4d6b4',
    fontFamily: "'Crimson Text', serif",
    outline: 'none',
  }

  const btnStyle: React.CSSProperties = {
    padding: '8px 14px',
    background: 'rgba(200,146,42,0.08)',
    border: '1px solid rgba(200,146,42,0.3)',
    color: '#d9a441',
    fontSize: '16px',
    fontFamily: "'Cinzel', serif",
    letterSpacing: '0.1em',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    transition: 'all 0.2s',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      role="presentation"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="relative flex flex-col md:flex-row w-full max-w-3xl max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
        // The overlay's window listener never sees a keydown from inside the
        // dialog, so Escape has to be handled here or the only way out is a mouse.
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        ref={dialogRef}
        style={{
          background: 'linear-gradient(160deg, #100e0a, #080705)',
          border: '1px solid #3d2f1c',
          boxShadow: '0 0 40px rgba(0,0,0,0.8), 0 0 80px rgba(200,146,42,0.05)',
        }}
      >
        {settingsNav()}
        <div data-testid="settings-content" className="flex-1 min-w-0 overflow-y-auto px-7 py-6">
          {/* Corner ornaments */}
          <div
            className="absolute top-0 left-0 w-4 h-4"
            style={{ borderTop: '1px solid rgba(200,146,42,0.5)', borderLeft: '1px solid rgba(200,146,42,0.5)' }}
          />
          <div
            className="absolute top-0 right-0 w-4 h-4"
            style={{ borderTop: '1px solid rgba(200,146,42,0.5)', borderRight: '1px solid rgba(200,146,42,0.5)' }}
          />
          <div
            className="absolute bottom-0 left-0 w-4 h-4"
            style={{ borderBottom: '1px solid rgba(200,146,42,0.5)', borderLeft: '1px solid rgba(200,146,42,0.5)' }}
          />
          <div
            className="absolute bottom-0 right-0 w-4 h-4"
            style={{ borderBottom: '1px solid rgba(200,146,42,0.5)', borderRight: '1px solid rgba(200,146,42,0.5)' }}
          />

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2
              style={{
                fontFamily: "'Cinzel', serif",
                fontSize: '16px',
                letterSpacing: '0.2em',
                color: '#d9a441',
                textShadow: '0 0 12px rgba(200,146,42,0.4)',
              }}
            >
              Configuration
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              style={{
                color: '#9d8b66',
                transition: 'color 0.2s',
                cursor: 'pointer',
                background: 'none',
                border: 'none',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#d9a441')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#9d8b66')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Divider */}
          <div
            className="mb-5"
            style={{ height: '1px', background: 'linear-gradient(to right, transparent, #3d2f1c, transparent)' }}
          />

          <div
            role="tabpanel"
            id={`settings-panel-audio`}
            aria-labelledby={`settings-tab-audio`}
            hidden={section !== 'audio'}
          >
            {/* Microphone */}
            <div className="mb-5">
              <Label>Listening Device</Label>
              {audioDevices.length === 0 ? (
                <div style={{ ...inputStyle, color: '#9d8b66', fontStyle: 'italic' }}>No devices found</div>
              ) : (
                <select value={selectedMic} onChange={(e) => handleMicChange(e.target.value)} style={inputStyle}>
                  <option value="">System default</option>
                  {audioDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              )}
              {micPermissionDenied && (
                <p className="mt-1 text-xs" style={{ color: '#b43c28' }}>
                  ⚠ Microphone permission denied —{' '}
                  <button
                    type="button"
                    onClick={() => window.doty.micOpenSettings()}
                    className="underline"
                    style={{ color: '#d9a441' }}
                  >
                    Open System Settings
                  </button>
                </p>
              )}
            </div>
            {/* Speaker */}
            <div className="mb-5">
              <Label>Sound Conduit</Label>
              {outputDevices.length === 0 ? (
                <div style={{ ...inputStyle, color: '#9d8b66', fontStyle: 'italic' }}>No devices found</div>
              ) : (
                <select
                  value={selectedSpeaker}
                  onChange={(e) => handleSpeakerChange(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">System default</option>
                  {outputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {/* Crossfade duration */}
            <div className="mb-5">
              <Label>Crossfade</Label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  aria-label="Crossfade duration"
                  min={0}
                  max={5000}
                  step={100}
                  value={crossfadeMs}
                  onChange={(e) => setCrossfadeMs(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#d9a441' }}
                />
                <span
                  style={{
                    fontSize: '15px',
                    color: '#e4d6b4',
                    fontFamily: "'IBM Plex Mono', monospace",
                    minWidth: '36px',
                    textAlign: 'right',
                  }}
                >
                  {(crossfadeMs / 1000).toFixed(1)}s
                </span>
              </div>
              <p style={{ fontSize: '14px', color: '#9d8b66', marginTop: '4px', fontFamily: "'Crimson Text', serif" }}>
                {crossfadeMs === 0 ? 'Instant transition between tracks' : 'Smooth fade between tracks'}
              </p>
            </div>
          </div>
          <div
            role="tabpanel"
            id={`settings-panel-library`}
            aria-labelledby={`settings-tab-library`}
            hidden={section !== 'library'}
          >
            {/* Music folder */}
            <div className="mb-5">
              <Label>Music Archive</Label>
              <div className="flex gap-2">
                <div
                  style={{
                    ...inputStyle,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {folder || <span style={{ color: '#9d8b66', fontStyle: 'italic' }}>No archive selected</span>}
                </div>
                <button
                  type="button"
                  onClick={pickFolder}
                  style={btnStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.15)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}
                >
                  Browse
                </button>
              </div>
              {folder && (
                <p
                  style={{
                    fontSize: '14px',
                    color: '#9d8b66',
                    marginTop: '6px',
                    fontFamily: "'Crimson Text', serif",
                  }}
                >
                  {trackCount} scrolls catalogued
                </p>
              )}
            </div>
            {/* Scan status */}
            {folder && (
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <Label>Arcane Analysis</Label>
                  <button
                    type="button"
                    onClick={rescan}
                    disabled={!!scanProgress}
                    style={{
                      fontSize: '16px',
                      color: scanProgress ? '#9d8b66' : '#d9a441',
                      fontFamily: "'Cinzel', serif",
                      letterSpacing: '0.1em',
                      background: 'none',
                      border: 'none',
                      cursor: scanProgress ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Re-analyse
                  </button>
                </div>
                {scanProgress ? (
                  <div>
                    <div style={{ width: '100%', height: '2px', background: '#3d2f1c', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${scanPercent}%`,
                          background: '#d9a441',
                          boxShadow: '0 0 6px rgba(200,146,42,0.6)',
                          transition: 'width 0.2s',
                        }}
                      />
                    </div>
                    <div
                      className="flex justify-between mt-1.5"
                      style={{ fontSize: '16px', color: '#9d8b66', fontFamily: "'IBM Plex Mono', monospace" }}
                    >
                      <span className="truncate max-w-[70%]">{scanProgress.current}</span>
                      <span>
                        {scanProgress.done} / {scanProgress.total}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div
                    className="flex items-center gap-2"
                    style={{ fontSize: '14px', color: '#9d8b66', fontFamily: "'Crimson Text', serif" }}
                  >
                    <div
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: scanDone ? '#6dbf95' : '#3d2f1c',
                        boxShadow: scanDone ? '0 0 6px rgba(74,138,106,0.7)' : 'none',
                      }}
                    />
                    {scanDone ? `Analysis complete${lastScanTime ? ` · ${lastScanTime}` : ''}` : 'Awaiting analysis...'}
                  </div>
                )}
              </div>
            )}

            {/* Outside the "music folder chosen" gate: the model can be missing with
            no folder set, which is exactly when the explanation matters. */}
            <p
              data-testid="index-summary"
              style={{
                fontSize: '13px',
                color: '#9d8b66',
                fontFamily: "'IBM Plex Mono', monospace",
                marginTop: '-8px',
                marginBottom: '16px',
              }}
            >
              {indexSummary(indexStatus)}
              {indexStatus?.ready && (
                <button
                  type="button"
                  onClick={() => void deleteModel('embedder')}
                  disabled={indexStatus.phase !== 'idle'}
                  title={
                    indexStatus.phase === 'idle'
                      ? 'Delete the embedding model; search falls back to names'
                      : 'Wait for the index pass to finish'
                  }
                  aria-label="Delete the embedding model"
                  style={{
                    display: 'block',
                    marginTop: '6px',
                    fontSize: '11px',
                    color: '#a5813f',
                    fontFamily: "'IBM Plex Mono', monospace",
                    background: 'none',
                    border: '1px solid rgba(200,146,42,0.25)',
                    padding: '2px 6px',
                    cursor: indexStatus.phase === 'idle' ? 'pointer' : 'default',
                    opacity: indexStatus.phase === 'idle' ? 1 : 0.4,
                  }}
                >
                  delete embedding model
                </button>
              )}
            </p>
            {/* SFX folder */}
            <div className="mb-5">
              <Label>Sound Effects Archive</Label>
              <div className="flex gap-2">
                <div
                  style={{
                    ...inputStyle,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {sfxFolder || <span style={{ color: '#9d8b66', fontStyle: 'italic' }}>No SFX archive selected</span>}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const picked = await window.doty.pickSfxFolder()
                    if (picked) setSfxFolder(picked)
                  }}
                  style={btnStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.15)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}
                >
                  Browse
                </button>
              </div>
              {sfxFolder && (
                <p
                  style={{
                    fontSize: '14px',
                    color: '#9d8b66',
                    marginTop: '6px',
                    fontFamily: "'Crimson Text', serif",
                  }}
                >
                  Effects loaded from this directory
                </p>
              )}
            </div>
            {/* SFX recommendation count */}
            <div className="mb-5">
              <Label>SFX Suggestions</Label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  aria-label="SFX suggestions"
                  min={1}
                  max={10}
                  value={sfxRecommendCount}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setSfxRecommendCount(v)
                    window.doty.setSfxRecommendationCount(v)
                  }}
                  style={{ flex: 1, accentColor: '#6dbf95' }}
                />
                <span
                  style={{
                    fontSize: '15px',
                    color: '#e4d6b4',
                    fontFamily: "'IBM Plex Mono', monospace",
                    minWidth: '24px',
                    textAlign: 'right',
                  }}
                >
                  {sfxRecommendCount}
                </span>
              </div>
              <p style={{ fontSize: '14px', color: '#9d8b66', marginTop: '4px', fontFamily: "'Crimson Text', serif" }}>
                Number of effects to suggest per scene
              </p>
            </div>
          </div>
          <div
            role="tabpanel"
            id={`settings-panel-transcription`}
            aria-labelledby={`settings-tab-transcription`}
            hidden={section !== 'transcription'}
          >
            {/* Transcript folder */}
            <div className="mb-5">
              <Label>Transcript Vault</Label>
              <div className="flex gap-2">
                <div
                  style={{
                    ...inputStyle,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {transcriptFolder || <span style={{ color: '#9d8b66', fontStyle: 'italic' }}>No vault selected</span>}
                </div>
                <button
                  type="button"
                  onClick={pickTranscriptFolder}
                  style={btnStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.15)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}
                >
                  Browse
                </button>
              </div>
              {transcriptFolder && (
                <p
                  style={{
                    fontSize: '14px',
                    color: '#9d8b66',
                    marginTop: '6px',
                    fontFamily: "'Crimson Text', serif",
                  }}
                >
                  Scrolls inscribed automatically
                </p>
              )}
            </div>
            {/* Models status */}
            <div className="mb-6">
              <Label>Cognition Engines</Label>

              {/* STT model selector */}
              <div
                className="mb-2"
                style={{ background: '#080705', border: '1px solid #3d2f1c', padding: '10px 12px' }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: sttReady ? '#6dbf95' : '#d9a441',
                      boxShadow: sttReady ? '0 0 6px rgba(74,138,106,0.7)' : '0 0 6px rgba(200,146,42,0.7)',
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: '15px', color: '#e4d6b4', fontFamily: "'Crimson Text', serif" }}>
                      Speech Recognition
                    </p>
                    <p style={{ fontSize: '13px', color: '#9d8b66', fontFamily: "'IBM Plex Mono', monospace" }}>
                      {sttReady ? 'Attuned' : 'Not yet summoned'}
                    </p>
                  </div>
                </div>

                {/* Model radio buttons — driven by registry */}
                <div className="space-y-1.5 mt-3">
                  {/* One radio group: the dot and the label describe the same choice. */}
                  <div role="radiogroup" aria-label="Speech recognition model">
                    {sttModelList.map((m) => {
                      const isDownloaded = m.ready
                      const isActive = sttModel === m.id
                      const isDownloading = whisperDownloading === m.id
                      const needsDownload = !isDownloaded

                      return (
                        <div
                          key={m.id}
                          className="flex items-center gap-2"
                          style={{
                            padding: '6px 8px',
                            background: isActive ? 'rgba(200,146,42,0.06)' : 'transparent',
                            border: isActive ? '1px solid rgba(200,146,42,0.2)' : '1px solid transparent',
                          }}
                        >
                          {/* Radio dot */}
                          <input
                            type="radio"
                            name="stt-model"
                            checked={isActive}
                            disabled={needsDownload || isDownloading}
                            onChange={async () => {
                              if (!needsDownload && !isActive) {
                                const result = await window.doty.setSttModel(m.id)
                                if (result.ok) {
                                  setSttModel(m.id)
                                  window.doty.getSttLanguage().then(setSttLanguage)
                                }
                              }
                            }}
                            aria-label={`Use ${m.label}`}
                            style={{
                              width: '18px',
                              height: '18px',
                              accentColor: '#d9a441',
                              flexShrink: 0,
                              cursor: !needsDownload && !isActive ? 'pointer' : 'default',
                            }}
                          />

                          {/* Label */}
                          <div className="flex-1 min-w-0">
                            <span style={{ fontSize: '13px', color: '#e4d6b4', fontFamily: "'Crimson Text', serif" }}>
                              {m.label}
                            </span>
                            <span
                              className="ml-1.5 px-1 rounded text-[10px]"
                              style={{ background: 'rgba(200,146,42,0.1)', color: '#a5813f' }}
                            >
                              {m.size}
                            </span>
                            <br />
                            <span
                              style={{ fontSize: '11px', color: '#9d8b66', fontFamily: "'IBM Plex Mono', monospace" }}
                            >
                              {m.description}
                            </span>
                          </div>

                          {/* Status / Download button */}
                          {isDownloading ? (
                            <span
                              style={{
                                fontSize: '11px',
                                color: '#d9a441',
                                fontFamily: "'IBM Plex Mono', monospace",
                                flexShrink: 0,
                              }}
                            >
                              {whisperProgress}%
                            </span>
                          ) : isDownloaded ? (
                            <>
                              <span
                                style={{
                                  fontSize: '11px',
                                  color: '#6dbf95',
                                  fontFamily: "'IBM Plex Mono', monospace",
                                  flexShrink: 0,
                                }}
                              >
                                ready
                              </span>
                              <button
                                type="button"
                                onClick={() => void deleteModel('stt', m.id)}
                                aria-label={`Delete ${m.label}`}
                                title="Delete the downloaded model; it downloads again when needed"
                                style={{
                                  fontSize: '11px',
                                  color: '#a5813f',
                                  fontFamily: "'IBM Plex Mono', monospace",
                                  background: 'none',
                                  border: '1px solid rgba(200,146,42,0.25)',
                                  padding: '2px 6px',
                                  cursor: 'pointer',
                                  flexShrink: 0,
                                }}
                              >
                                delete
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={whisperDownloading !== null}
                              onClick={async () => {
                                setWhisperDownloading(m.id)
                                setWhisperProgress(0)
                                setWhisperDownloadError(null)
                                try {
                                  const res = await window.doty.downloadModel(m.id)
                                  if (!res.ok && res.reason !== 'cancelled') {
                                    setWhisperDownloadError(res.reason ?? 'Download failed')
                                  }
                                } catch (e) {
                                  setWhisperDownloadError(String(e))
                                  console.error('Model download failed:', e)
                                }
                                setWhisperDownloading(null)
                                window.doty.getSttModelStatus().then(setSttModelStatus)
                                window.doty.getSttModelList().then(setSttModelList)
                              }}
                              style={{
                                fontSize: '11px',
                                color: '#d9a441',
                                fontFamily: "'IBM Plex Mono', monospace",
                                background: 'none',
                                border: '1px solid rgba(200,146,42,0.3)',
                                padding: '2px 8px',
                                cursor: whisperDownloading === null ? 'pointer' : 'default',
                                opacity: whisperDownloading === null ? 1 : 0.4,
                                flexShrink: 0,
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.1)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                            >
                              download
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {modelMessage && (
                  <p
                    style={{
                      fontSize: '12px',
                      color: '#e07a5f',
                      fontFamily: "'IBM Plex Mono', monospace",
                      marginTop: '8px',
                    }}
                  >
                    {modelMessage}
                  </p>
                )}

                {/* Focused language — avoids per-utterance language detection */}
                <div
                  className="flex items-center gap-2 mt-3"
                  style={{ fontSize: '12px', fontFamily: "'IBM Plex Mono', monospace" }}
                >
                  <span style={{ color: '#a5813f' }}>Language</span>
                  <select
                    aria-label="Speech language"
                    value={sttLanguage}
                    onChange={async (e) => {
                      const language = e.target.value
                      const result = await window.doty.setSttLanguage(language)
                      if (result.ok) {
                        setSttLanguage(language)
                        window.doty.rankerStatus().then((s) => setRankerLanguageCovered(s.languageCovered))
                      }
                    }}
                    style={{
                      background: '#080705',
                      color: '#e4d6b4',
                      border: '1px solid #3d2f1c',
                      fontSize: '12px',
                      padding: '2px 4px',
                    }}
                  >
                    <option value="auto">Auto-detect</option>
                    {(sttLanguageOptions ?? []).map((code) => (
                      <option key={code} value={code}>
                        {LANGUAGE_LABELS[code] ?? code}
                      </option>
                    ))}
                  </select>
                  {sttLanguage !== 'auto' && <span style={{ color: '#9d8b66' }}>focused — faster, more accurate</span>}
                </div>

                {/* Download progress bar */}
                {whisperDownloading && (
                  <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ flex: 1, height: '2px', background: '#3d2f1c', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${whisperProgress}%`,
                          background: '#d9a441',
                          boxShadow: '0 0 6px rgba(200,146,42,0.6)',
                          transition: 'width 0.3s',
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => window.doty.cancelSttDownload()}
                      style={{
                        fontSize: '11px',
                        color: '#d9a441',
                        fontFamily: "'IBM Plex Mono', monospace",
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      cancel
                    </button>
                  </div>
                )}
                {whisperDownloadError && (
                  <p
                    style={{
                      marginTop: '6px',
                      fontSize: '11px',
                      color: '#e07a5f',
                      fontFamily: "'IBM Plex Mono', monospace",
                    }}
                  >
                    Download failed: {whisperDownloadError}
                  </p>
                )}
              </div>

              {/* d1-omni decision ranker */}
              <div style={{ background: '#080705', border: '1px solid #3d2f1c', padding: '10px 12px' }}>
                <div className="flex items-center gap-3">
                  <div
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: rankerDotColor,
                      boxShadow: rankerDotShadow,
                      animation: !rankerIsReady ? 'pulse 1.5s ease-in-out infinite' : 'none',
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: '15px', color: '#e4d6b4', fontFamily: "'Crimson Text', serif" }}>
                      d1-omni Decision Ranker
                    </p>
                    <p style={{ fontSize: '13px', color: '#9d8b66', fontFamily: "'IBM Plex Mono', monospace" }}>
                      {rankerLabel}
                    </p>
                  </div>
                  {rankerProgress !== null ? (
                    <span
                      style={{
                        fontSize: '11px',
                        color: '#d9a441',
                        fontFamily: "'IBM Plex Mono', monospace",
                        flexShrink: 0,
                      }}
                    >
                      {rankerProgress}%
                    </span>
                  ) : rankerInstalled === false ? (
                    <button
                      type="button"
                      onClick={() => {
                        setRankerDownloadError(null)
                        window.doty.rankerDownload()
                      }}
                      title="Downloads once, in the background. Keyword matching covers you until it lands."
                      style={{
                        fontSize: '11px',
                        color: '#d9a441',
                        fontFamily: "'IBM Plex Mono', monospace",
                        background: 'none',
                        border: '1px solid rgba(200,146,42,0.3)',
                        padding: '2px 8px',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      download 1.4 GB
                    </button>
                  ) : (
                    !rankerIsReady && (
                      <span style={{ fontSize: '13px', color: '#9d8b66', fontFamily: "'IBM Plex Mono', monospace" }}>
                        1.4 GB
                      </span>
                    )
                  )}
                </div>
                {rankerDownloadError && (
                  <p
                    style={{
                      fontSize: '11px',
                      color: '#e07a5f',
                      fontFamily: "'IBM Plex Mono', monospace",
                      marginTop: '4px',
                    }}
                  >
                    Download failed: {rankerDownloadError}
                  </p>
                )}
                <p
                  style={{
                    fontSize: '11px',
                    color: '#9d8b66',
                    fontFamily: "'IBM Plex Mono', monospace",
                    marginTop: '4px',
                  }}
                >
                  {rankerInstalled === false
                    ? 'Not installed — suggestions fall back to keyword matching'
                    : !rankerLanguageCovered
                      ? `Does not read ${LANGUAGE_LABELS[sttLanguage] ?? sttLanguage} — it will still rank, but may be weaker`
                      : 'Ranked by the decision model on your machine'}
                </p>
                {rankerInstalled && rankerProgress === null && (
                  <button
                    type="button"
                    onClick={() => void deleteModel('ranker')}
                    aria-label="Delete the decision model"
                    style={{
                      marginTop: '6px',
                      fontSize: '11px',
                      color: '#a5813f',
                      fontFamily: "'IBM Plex Mono', monospace",
                      background: 'none',
                      border: '1px solid rgba(200,146,42,0.25)',
                      padding: '2px 6px',
                      cursor: 'pointer',
                    }}
                  >
                    delete downloaded model
                  </button>
                )}
              </div>
            </div>
          </div>
          <div
            role="tabpanel"
            id={`settings-panel-director`}
            aria-labelledby={`settings-tab-director`}
            hidden={section !== 'director'}
          >
            {/* Recommendation count */}
            <div className="mb-5">
              <Label>Recommendations</Label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  aria-label="Recommendations per query"
                  min={1}
                  max={20}
                  value={recommendCount}
                  onChange={(e) => onRecommendCountChange(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#d9a441' }}
                />
                <span
                  style={{
                    fontSize: '15px',
                    color: '#e4d6b4',
                    fontFamily: "'IBM Plex Mono', monospace",
                    minWidth: '24px',
                    textAlign: 'right',
                  }}
                >
                  {recommendCount}
                </span>
              </div>
              <p style={{ fontSize: '14px', color: '#9d8b66', marginTop: '4px', fontFamily: "'Crimson Text', serif" }}>
                Number of tracks to suggest per query
              </p>
            </div>
            {/* Divider before Discord */}
            <div
              className="mb-5"
              style={{ height: '1px', background: 'linear-gradient(to right, transparent, #3d2f1c, transparent)' }}
            />
            {/* Discord integration — mounted whatever the group, so an open
                  token field keeps what was typed. */}
            <div className="mb-6">
              <DiscordPanel />
            </div>
            {/* Home Assistant: absent from the page until it is configured. */}
            <div className="mb-6">
              <HomeAssistantPanel />
            </div>
            {/* Divider before future features */}
            <div
              className="mb-5"
              style={{ height: '1px', background: 'linear-gradient(to right, transparent, #3d2f1c, transparent)' }}
            />
            {/* Director */}
            <div className="mb-2">
              <Label>Director</Label>

              {/* Autopilot (#12) */}
              <div
                className="mb-2"
                style={{ background: '#080705', border: '1px solid #3d2f1c', padding: '10px 12px' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <p style={{ fontSize: '15px', color: '#e4d6b4', fontFamily: "'Crimson Text', serif" }}>
                      Autopilot Mode
                    </p>
                    <span
                      style={{
                        fontSize: '11px',
                        color: '#d9a441',
                        border: '1px solid rgba(200,146,42,0.3)',
                        padding: '1px 5px',
                        fontFamily: "'IBM Plex Mono', monospace",
                      }}
                    >
                      {autopilotEnabled ? 'MASTER ON' : 'MASTER OFF'}
                    </span>
                  </div>
                </div>
                <p
                  style={{
                    fontSize: '12px',
                    color: '#9d8b66',
                    fontFamily: "'IBM Plex Mono', monospace",
                    marginBottom: '8px',
                  }}
                >
                  The master switch is in the header, off until you turn it on. While it is off nothing changes on its
                  own; these switches decide what it may touch once it is on.
                </p>

                <div className="space-y-3">
                  {/* Individual channel toggles */}
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        const next = !autopilotMusic
                        setAutopilotMusic(next)
                        window.doty.setAutopilotConfig({ musicEnabled: next })
                      }}
                      className="flex items-center gap-2"
                      style={{
                        fontSize: '12px',
                        fontFamily: "'IBM Plex Mono', monospace",
                        color: autopilotMusic ? '#d9a441' : '#9d8b66',
                      }}
                    >
                      <div
                        className="w-3 h-3 border"
                        style={{
                          borderColor: autopilotMusic ? '#d9a441' : '#9d8b66',
                          background: autopilotMusic ? '#d9a441' : 'transparent',
                        }}
                      />
                      Music
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        const next = !autopilotSfx
                        setAutopilotSfx(next)
                        window.doty.setAutopilotConfig({ sfxEnabled: next })
                      }}
                      className="flex items-center gap-2"
                      style={{
                        fontSize: '12px',
                        fontFamily: "'IBM Plex Mono', monospace",
                        color: autopilotSfx ? '#6dbf95' : '#9d8b66',
                      }}
                    >
                      <div
                        className="w-3 h-3 border"
                        style={{
                          borderColor: autopilotSfx ? '#6dbf95' : '#9d8b66',
                          background: autopilotSfx ? '#6dbf95' : 'transparent',
                        }}
                      />
                      SFX
                    </button>
                  </div>

                  {/* Confidence threshold */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span style={{ fontSize: '11px', color: '#a5813f', fontFamily: "'IBM Plex Mono', monospace" }}>
                        Confidence threshold
                      </span>
                      <span style={{ fontSize: '11px', color: '#d9a441', fontFamily: "'IBM Plex Mono', monospace" }}>
                        {Math.round(autopilotThreshold * 100)}% — {confidenceLabel(autopilotThreshold)}
                      </span>
                    </div>
                    <input
                      type="range"
                      aria-label="Autopilot confidence threshold"
                      min={80}
                      max={99}
                      value={Math.round(autopilotThreshold * 100)}
                      onChange={(e) => {
                        const v = Number(e.target.value) / 100
                        setAutopilotThreshold(v)
                        window.doty.setAutopilotConfig({ confidenceThreshold: v })
                      }}
                      className="w-full"
                      style={{ accentColor: '#d9a441', height: '2px' }}
                    />
                  </div>

                  {/* Crossfade duration */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span style={{ fontSize: '11px', color: '#a5813f', fontFamily: "'IBM Plex Mono', monospace" }}>
                        Crossfade duration
                      </span>
                      <span style={{ fontSize: '11px', color: '#d9a441', fontFamily: "'IBM Plex Mono', monospace" }}>
                        {autopilotCrossfade}s
                      </span>
                    </div>
                    <input
                      type="range"
                      aria-label="Autopilot crossfade duration"
                      min={1}
                      max={10}
                      value={autopilotCrossfade}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        setAutopilotCrossfade(v)
                        window.doty.setAutopilotConfig({ crossfadeDuration: v })
                      }}
                      className="w-full"
                      style={{ accentColor: '#d9a441', height: '2px' }}
                    />
                  </div>
                </div>
              </div>

              {/* Remote Control (#22) */}
              <div
                className="flex items-center gap-3"
                style={{ background: '#080705', border: '1px solid #3d2f1c', padding: '10px 12px', opacity: 0.5 }}
              >
                <div
                  style={{ width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, background: '#3d2f1c' }}
                />
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: '15px', color: '#e4d6b4', fontFamily: "'Crimson Text', serif" }}>
                    Remote Control
                  </p>
                  <p style={{ fontSize: '13px', color: '#9d8b66', fontFamily: "'IBM Plex Mono', monospace" }}>
                    HTTP API + Stream Deck support
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div
            role="tabpanel"
            id={`settings-panel-updates`}
            aria-labelledby={`settings-tab-updates`}
            hidden={section !== 'updates'}
          >
            <Label>Updates</Label>
            <p style={{ fontSize: '15px', color: '#e4d6b4', fontFamily: "'Crimson Text', serif", marginBottom: '8px' }}>
              Doty {appVersion || '…'}
            </p>
            <p
              style={{
                fontSize: '13px',
                color: '#9d8b66',
                fontFamily: "'IBM Plex Mono', monospace",
                marginBottom: '12px',
              }}
            >
              {updateText}
            </p>
            {update.status === 'downloading' && (
              <div className="mb-3" style={{ height: '3px', background: 'rgba(217,164,65,0.2)' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${update.percent}%`,
                    background: 'linear-gradient(to right, #a5813f, #d9a441)',
                  }}
                />
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void checkNow()}
                disabled={update.status === 'downloading' || update.status === 'installing'}
                style={{
                  fontSize: '12px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: '#d9a441',
                  border: '1px solid rgba(200,146,42,0.4)',
                  padding: '4px 10px',
                  opacity: update.status === 'downloading' || update.status === 'installing' ? 0.4 : 1,
                }}
              >
                Check for updates
              </button>
              {(update.status === 'available' || update.status === 'error') && (
                <button
                  type="button"
                  onClick={async () => {
                    setUpdateNotice(null)
                    const result = await window.doty.updateInstall().catch((e) => ({ ok: false, error: String(e) }))
                    if (!result.ok) setUpdateNotice(result.error ?? 'Could not install the update')
                  }}
                  style={{
                    fontSize: '12px',
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: '#e4d6b4',
                    border: '1px solid rgba(217,164,65,0.5)',
                    padding: '4px 10px',
                  }}
                >
                  {update.status === 'error' ? 'Try again' : 'Update & restart'}
                </button>
              )}
            </div>
            {updateNotice && (
              <p
                style={{
                  fontSize: '12px',
                  color: '#9d8b66',
                  fontFamily: "'IBM Plex Mono', monospace",
                  marginTop: '10px',
                }}
              >
                {updateNotice}
              </p>
            )}
            <p style={{ fontSize: '12px', color: '#9d8b66', fontFamily: "'Crimson Text', serif", marginTop: '14px' }}>
              Updates download in the background and replace the app after it quits. They are only available from the
              installed app, not a development build.
            </p>
          </div>
          <div
            role="tabpanel"
            id={`settings-panel-advanced`}
            aria-labelledby={`settings-tab-advanced`}
            hidden={section !== 'advanced'}
          >
            {/* Debug mode */}
            <div className="mb-5">
              <Label>Debug Mode</Label>
              <div style={{ background: '#080705', border: '1px solid #3d2f1c', padding: '10px 12px' }}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p style={{ fontSize: '15px', color: '#e4d6b4', fontFamily: "'Crimson Text', serif" }}>
                      Capture diagnostics
                    </p>
                    <p style={{ fontSize: '13px', color: '#9d8b66', fontFamily: "'IBM Plex Mono', monospace" }}>
                      Verbose logs go to a file on this Mac. Nothing is uploaded.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={debugState?.enabled ?? false}
                    onClick={toggleDebug}
                    className="flex items-center gap-2 shrink-0"
                    style={{
                      fontSize: '12px',
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: debugState?.enabled ? '#d9a441' : '#9d8b66',
                    }}
                  >
                    <span
                      className="w-3 h-3 border"
                      style={{
                        borderColor: debugState?.enabled ? '#d9a441' : '#9d8b66',
                        background: debugState?.enabled ? '#d9a441' : 'transparent',
                      }}
                    />
                    {debugState?.enabled ? 'On' : 'Off'}
                  </button>
                </div>
                {debugState?.enabled && (
                  <div className="mt-3">
                    <p
                      style={{
                        fontSize: '12px',
                        color: '#a5813f',
                        fontFamily: "'IBM Plex Mono', monospace",
                        wordBreak: 'break-all',
                      }}
                    >
                      {debugState.logPath}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => window.doty.debugOpenLog()}
                        style={btnStyle}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.15)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}
                      >
                        Open log
                      </button>
                      <button
                        type="button"
                        onClick={refreshDebug}
                        style={btnStyle}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.15)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* What this machine reports */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <Label>This Machine</Label>
                <button
                  type="button"
                  onClick={copyDiagnostics}
                  style={btnStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.15)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(200,146,42,0.08)')}
                >
                  Copy
                </button>
              </div>
              <pre
                data-testid="debug-diagnostics"
                style={{
                  background: '#080705',
                  border: '1px solid #3d2f1c',
                  padding: '10px 12px',
                  fontSize: '12px',
                  lineHeight: 1.6,
                  color: '#e4d6b4',
                  fontFamily: "'IBM Plex Mono', monospace",
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {debugState?.diagnostics ?? 'Reading…'}
              </pre>
            </div>

            {debugState?.enabled && (
              <div className="mb-5">
                <Label>Recent Log</Label>
                <pre
                  data-testid="debug-log"
                  style={{
                    background: '#080705',
                    border: '1px solid #3d2f1c',
                    padding: '10px 12px',
                    maxHeight: '220px',
                    overflow: 'auto',
                    fontSize: '11px',
                    lineHeight: 1.5,
                    color: '#b9a683',
                    fontFamily: "'IBM Plex Mono', monospace",
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {debugState.log || 'No entries yet.'}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
