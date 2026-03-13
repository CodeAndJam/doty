import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PlayerBar, { trackName } from '../../components/PlayerBar'
import type { LoopMode } from '../../types'

const defaults = {
  filename: 'tavern_ambience.mp3',
  isPlaying: false,
  progress: 0,
  currentTime: 0,
  duration: 180,
  volume: 0.8,
  muted: false,
  loopMode: 'off' as LoopMode,
  onToggle: vi.fn(),
  onSeek: vi.fn(),
  onSeekStart: vi.fn(),
  onSeekEnd: vi.fn(),
  onVolumeChange: vi.fn(),
  onToggleMute: vi.fn(),
  onCycleLoop: vi.fn(),
}

function renderBar(overrides: Partial<typeof defaults> = {}) {
  const props = { ...defaults, ...overrides }
  // Reset all mocks
  Object.values(props).forEach(v => { if (typeof v === 'function') (v as ReturnType<typeof vi.fn>).mockClear() })
  return render(<PlayerBar {...props} />)
}

describe('trackName', () => {
  it('strips extension', () => {
    expect(trackName('tavern_ambience.mp3')).toBe('tavern_ambience')
  })

  it('strips path and extension', () => {
    expect(trackName('/music/folder/battle.ogg')).toBe('battle')
    expect(trackName('C:\\music\\rain.wav')).toBe('rain')
  })

  it('handles filenames without extension', () => {
    expect(trackName('noext')).toBe('noext')
  })
})

describe('PlayerBar', () => {
  it('renders track name without extension on hover', () => {
    renderBar()
    fireEvent.mouseEnter(screen.getByLabelText('Track info'))
    expect(screen.getByText('tavern_ambience')).toBeInTheDocument()
  })

  it('shows play icon when paused', () => {
    renderBar({ isPlaying: false })
    // The play/pause button is the first button
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toBeInTheDocument()
  })

  it('calls onToggle when play button clicked', () => {
    const onToggle = vi.fn()
    renderBar({ onToggle })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('displays formatted time on hover', () => {
    renderBar({ currentTime: 65, duration: 180 })
    fireEvent.mouseEnter(screen.getByLabelText('Track info'))
    // 65s = 1:05, 180s = 3:00
    expect(screen.getByText('1:05 / 3:00')).toBeInTheDocument()
  })

  it('displays only elapsed time when duration is 0 on hover', () => {
    renderBar({ currentTime: 10, duration: 0 })
    fireEvent.mouseEnter(screen.getByLabelText('Track info'))
    expect(screen.getByText('0:10')).toBeInTheDocument()
  })

  it('renders seek slider with correct aria attributes', () => {
    renderBar({ progress: 0.5 })
    const slider = screen.getByRole('slider', { name: 'Seek' })
    expect(slider).toHaveAttribute('aria-valuenow', '50')
    expect(slider).toHaveAttribute('aria-valuemin', '0')
    expect(slider).toHaveAttribute('aria-valuemax', '100')
  })

  it('calls onSeek on ArrowRight key', () => {
    const onSeek = vi.fn()
    renderBar({ onSeek, progress: 0.5, duration: 100 })
    const slider = screen.getByRole('slider', { name: 'Seek' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onSeek).toHaveBeenCalledOnce()
    // progress + 5/duration = 0.5 + 0.05 = 0.55
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(0.55)
  })

  it('calls onSeek on ArrowLeft key', () => {
    const onSeek = vi.fn()
    renderBar({ onSeek, progress: 0.5, duration: 100 })
    const slider = screen.getByRole('slider', { name: 'Seek' })
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    expect(onSeek).toHaveBeenCalledOnce()
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(0.45)
  })

  it('clamps seek to 0 on ArrowLeft near start', () => {
    const onSeek = vi.fn()
    renderBar({ onSeek, progress: 0.01, duration: 100 })
    const slider = screen.getByRole('slider', { name: 'Seek' })
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    expect(onSeek.mock.calls[0][0]).toBe(0)
  })

  it('shows loop off state', () => {
    renderBar({ loopMode: 'off' })
    expect(screen.getByTitle('Loop off — playback stops at end')).toBeInTheDocument()
  })

  it('shows loop single state', () => {
    renderBar({ loopMode: 'single' })
    expect(screen.getByTitle('Looping track — current track repeats')).toBeInTheDocument()
  })

  it('shows loop queue state', () => {
    renderBar({ loopMode: 'queue' })
    expect(screen.getByTitle('Looping queue — restarts from first track')).toBeInTheDocument()
  })

  it('calls onCycleLoop when loop button clicked', () => {
    const onCycleLoop = vi.fn()
    renderBar({ onCycleLoop })
    fireEvent.click(screen.getByTitle('Loop off — playback stops at end'))
    expect(onCycleLoop).toHaveBeenCalledOnce()
  })

  it('calls onToggleMute when volume button clicked', () => {
    const onToggleMute = vi.fn()
    renderBar({ onToggleMute })
    fireEvent.click(screen.getByTitle('Mute'))
    expect(onToggleMute).toHaveBeenCalledOnce()
  })

  it('shows Unmute title when muted', () => {
    renderBar({ muted: true })
    expect(screen.getByTitle('Unmute')).toBeInTheDocument()
  })

  it('shows playing indicator when playing', () => {
    const { container } = renderBar({ isPlaying: true })
    // 5 animated bars
    const bars = container.querySelectorAll('.animate-bounce')
    expect(bars.length).toBe(5)
  })

  it('hides playing indicator when paused', () => {
    const { container } = renderBar({ isPlaying: false })
    const bars = container.querySelectorAll('.animate-bounce')
    expect(bars.length).toBe(0)
  })

  it('shows volume slider on hover', async () => {
    renderBar()
    // Volume slider is hidden by default
    expect(screen.queryByLabelText('Volume')).not.toBeInTheDocument()
    // Hover over the volume area (parent of the mute button)
    const muteBtn = screen.getByTitle('Mute')
    fireEvent.mouseEnter(muteBtn.parentElement!)
    expect(screen.getByLabelText('Volume')).toBeInTheDocument()
    fireEvent.mouseLeave(muteBtn.parentElement!)
    expect(screen.queryByLabelText('Volume')).not.toBeInTheDocument()
  })

  it('calls onVolumeChange when volume slider changes', () => {
    const onVolumeChange = vi.fn()
    renderBar({ onVolumeChange })
    // Show volume popup
    const muteBtn = screen.getByTitle('Mute')
    fireEvent.mouseEnter(muteBtn.parentElement!)
    const slider = screen.getByLabelText('Volume')
    fireEvent.change(slider, { target: { value: '50' } })
    expect(onVolumeChange).toHaveBeenCalledWith(0.5)
  })

  // ── Queue integration ──────────────────────────────────────────────

  it('shows skip buttons when onSkipNext/onSkipPrev are provided', () => {
    renderBar({ onSkipNext: vi.fn(), onSkipPrev: vi.fn() } as any)
    expect(screen.getByTitle('Next track (N)')).toBeTruthy()
    expect(screen.getByTitle('Previous track (P)')).toBeTruthy()
  })

  it('does not show skip buttons when handlers are not provided', () => {
    renderBar()
    expect(screen.queryByTitle('Next track (N)')).toBeNull()
    expect(screen.queryByTitle('Previous track (P)')).toBeNull()
  })

  it('calls onSkipNext when next button is clicked', () => {
    const onSkipNext = vi.fn()
    renderBar({ onSkipNext } as any)
    fireEvent.click(screen.getByTitle('Next track (N)'))
    expect(onSkipNext).toHaveBeenCalledOnce()
  })

  it('calls onSkipPrev when prev button is clicked', () => {
    const onSkipPrev = vi.fn()
    renderBar({ onSkipPrev } as any)
    fireEvent.click(screen.getByTitle('Previous track (P)'))
    expect(onSkipPrev).toHaveBeenCalledOnce()
  })

  it('shows queue position when queuePosition is provided on hover', () => {
    renderBar({ queuePosition: [2, 10] } as any)
    fireEvent.mouseEnter(screen.getByLabelText('Track info'))
    expect(screen.getByText('3/10')).toBeTruthy()
  })

  it('does not show queue position when queuePosition is null', () => {
    renderBar({ queuePosition: null } as any)
    expect(screen.queryByText(/\/\d+/)).toBeNull()
  })

  it('shows queue toggle button when onToggleQueue is provided', () => {
    renderBar({ onToggleQueue: vi.fn() } as any)
    expect(screen.getByTitle('Queue')).toBeTruthy()
  })

  it('calls onToggleQueue when queue button is clicked', () => {
    const onToggleQueue = vi.fn()
    renderBar({ onToggleQueue } as any)
    fireEvent.click(screen.getByTitle('Queue'))
    expect(onToggleQueue).toHaveBeenCalledOnce()
  })
})
