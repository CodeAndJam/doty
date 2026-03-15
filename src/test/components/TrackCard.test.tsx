import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TrackCard from '../../components/TrackCard'

const defaults = {
  filename: 'dark_forest/tavern_ambience.mp3',
  isPlaying: false,
  isPinned: false,
  showReorder: false,
  canMoveUp: false,
  canMoveDown: false,
  onPlay: vi.fn(),
  onPin: vi.fn(),
  onMoveUp: vi.fn(),
  onMoveDown: vi.fn(),
}

function renderCard(overrides: Partial<typeof defaults> = {}) {
  return render(<TrackCard {...defaults} {...overrides} />)
}

describe('TrackCard', () => {
  it('renders track name without path or extension', () => {
    renderCard()
    expect(screen.getByText('tavern_ambience')).toBeInTheDocument()
  })

  it('calls onPlay when play button is clicked', () => {
    const onPlay = vi.fn()
    renderCard({ onPlay })
    const playBtn = screen.getAllByRole('button')[0]
    fireEvent.click(playBtn)
    expect(onPlay).toHaveBeenCalledOnce()
  })

  it('calls onPin when pin button is clicked', () => {
    const onPin = vi.fn()
    renderCard({ onPin })
    fireEvent.click(screen.getByTitle('Pin'))
    expect(onPin).toHaveBeenCalledOnce()
  })

  it('shows Unpin title when pinned', () => {
    renderCard({ isPinned: true })
    expect(screen.getByTitle('Unpin')).toBeInTheDocument()
  })

  it('renders tag pills when tags are provided', () => {
    renderCard({ tags: ['combat', 'epic', 'boss'] } as any)
    expect(screen.getByText('combat')).toBeInTheDocument()
    expect(screen.getByText('epic')).toBeInTheDocument()
    expect(screen.getByText('boss')).toBeInTheDocument()
  })

  it('shows +N for tags beyond 3', () => {
    renderCard({ tags: ['a', 'b', 'c', 'd', 'e'] } as any)
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('shows reorder buttons when showReorder is true', () => {
    renderCard({ showReorder: true, canMoveUp: true, canMoveDown: true })
    const buttons = screen.getAllByRole('button')
    // Should have play, move up, move down, pin (at minimum)
    expect(buttons.length).toBeGreaterThanOrEqual(4)
  })

  it('calls onMoveUp and onMoveDown', () => {
    const onMoveUp = vi.fn()
    const onMoveDown = vi.fn()
    renderCard({ showReorder: true, canMoveUp: true, canMoveDown: true, onMoveUp, onMoveDown })
    // The reorder buttons are the small chevron buttons
    const allButtons = screen.getAllByRole('button')
    // Find the two reorder buttons (they have p-1.5 class)
    const reorderBtns = allButtons.filter((b) => b.classList.contains('p-1'))
    expect(reorderBtns).toHaveLength(2)
    fireEvent.click(reorderBtns[0]) // up
    fireEvent.click(reorderBtns[1]) // down
    expect(onMoveUp).toHaveBeenCalledOnce()
    expect(onMoveDown).toHaveBeenCalledOnce()
  })

  it('shows NEXT and QUEUE buttons when handlers provided', () => {
    renderCard({ onPlayNext: vi.fn(), onAddToQueue: vi.fn() } as any)
    expect(screen.getByTitle('Play next')).toBeInTheDocument()
    expect(screen.getByTitle('Add to queue')).toBeInTheDocument()
  })

  it('calls onPlayNext and onAddToQueue', () => {
    const onPlayNext = vi.fn()
    const onAddToQueue = vi.fn()
    renderCard({ onPlayNext, onAddToQueue } as any)
    fireEvent.click(screen.getByTitle('Play next'))
    fireEvent.click(screen.getByTitle('Add to queue'))
    expect(onPlayNext).toHaveBeenCalledOnce()
    expect(onAddToQueue).toHaveBeenCalledOnce()
  })

  it('shows tag edit button when onTagsChange is provided', () => {
    renderCard({ onTagsChange: vi.fn() } as any)
    expect(screen.getByTitle('Edit tags')).toBeInTheDocument()
  })

  it('shows metadata tooltip on hover when meta is provided', () => {
    const meta = {
      bpm: 120,
      bpmConfidence: 0.9,
      key: 'C',
      scale: 'minor',
      danceability: 0.5,
      energy: 0.7,
      duration: 185,
      mtime: 0,
      title: null,
      artist: 'Bard',
      album: null,
      genre: 'Fantasy',
      year: null,
      trackNo: null,
      bitrate: 320,
      sampleRate: 44100,
      channels: 2,
      codec: 'mp3',
    }
    renderCard({ meta } as any)
    const infoWrapper = screen.getByTitle('Track details').parentElement!
    fireEvent.mouseEnter(infoWrapper)
    expect(screen.getByText('120 (90%)')).toBeInTheDocument()
    expect(screen.getByText('C minor')).toBeInTheDocument()
    expect(screen.getByText('Bard')).toBeInTheDocument()
    expect(screen.getByText('Fantasy')).toBeInTheDocument()
    expect(screen.getByText('320 kbps')).toBeInTheDocument()
  })

  it('hides metadata tooltip on mouse leave', () => {
    const meta = {
      bpm: 120,
      bpmConfidence: 0.9,
      key: 'C',
      scale: 'minor',
      danceability: 0.5,
      energy: 0.7,
      duration: 185,
      mtime: 0,
      title: null,
      artist: 'Bard',
      album: null,
      genre: null,
      year: null,
      trackNo: null,
      bitrate: null,
      sampleRate: null,
      channels: null,
      codec: null,
    }
    renderCard({ meta } as any)
    const infoWrapper = screen.getByTitle('Track details').parentElement!
    fireEvent.mouseEnter(infoWrapper)
    expect(screen.getByText('120 (90%)')).toBeInTheDocument()
    fireEvent.mouseLeave(infoWrapper)
    expect(screen.queryByText('120 (90%)')).toBeNull()
  })

  it('shows directory in metadata tooltip', () => {
    const meta = {
      bpm: 0,
      bpmConfidence: 0,
      key: '',
      scale: '',
      danceability: 0,
      energy: 0,
      duration: 0,
      mtime: 0,
      title: null,
      artist: null,
      album: null,
      genre: null,
      year: null,
      trackNo: null,
      bitrate: null,
      sampleRate: null,
      channels: null,
      codec: null,
    }
    renderCard({ meta } as any)
    const infoWrapper = screen.getByTitle('Track details').parentElement!
    fireEvent.mouseEnter(infoWrapper)
    expect(screen.getByText('dark_forest')).toBeInTheDocument()
  })
})
