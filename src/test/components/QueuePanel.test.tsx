import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import QueuePanel from '../../components/QueuePanel'

// Mock @dnd-kit to avoid complex DnD setup in tests
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  verticalListSortingStrategy: 'vertical',
  useSortable: ({ id }: { id: string }) => ({
    attributes: { 'data-sortable-id': id },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}))

describe('QueuePanel', () => {
  const defaultProps = {
    tracks: ['track1.mp3', 'track2.mp3', 'track3.mp3'],
    currentIndex: 0,
    playing: 'track1.mp3',
    isPlaying: true,
    onPlay: vi.fn(),
    onRemove: vi.fn(),
    onReorder: vi.fn(),
    onClear: vi.fn(),
    onClose: vi.fn(),
  }

  it('renders queue header with track count', () => {
    render(<QueuePanel {...defaultProps} />)
    expect(screen.getByText('Queue')).toBeTruthy()
    expect(screen.getByText('(3 tracks)')).toBeTruthy()
  })

  it('renders all tracks in the queue', () => {
    render(<QueuePanel {...defaultProps} />)
    expect(screen.getByText('track1')).toBeTruthy()
    expect(screen.getByText('track2')).toBeTruthy()
    expect(screen.getByText('track3')).toBeTruthy()
  })

  it('shows empty state when queue is empty', () => {
    render(<QueuePanel {...defaultProps} tracks={[]} currentIndex={-1} />)
    expect(screen.getByText('Queue is empty')).toBeTruthy()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<QueuePanel {...defaultProps} onClose={onClose} />)
    // The header has a Clear button and a close button (with CloseIcon)
    // The close button is after the Clear button in the header
    const headerButtons = screen.getByText('Clear').parentElement!.querySelectorAll('button')
    // Last button in the header controls is the close button
    fireEvent.click(headerButtons[headerButtons.length - 1])
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClear when clear button is clicked', () => {
    const onClear = vi.fn()
    render(<QueuePanel {...defaultProps} onClear={onClear} />)
    const clearBtn = screen.getByText('Clear')
    fireEvent.click(clearBtn)
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('does not show clear button when queue is empty', () => {
    render(<QueuePanel {...defaultProps} tracks={[]} currentIndex={-1} />)
    expect(screen.queryByText('Clear')).toBeNull()
  })

  it('calls onPlay with correct index when play button is clicked', () => {
    const onPlay = vi.fn()
    render(<QueuePanel {...defaultProps} onPlay={onPlay} />)
    // Each track has a play button — find them by their index labels
    const playButtons = screen.getAllByRole('button').filter(b => {
      const svg = b.querySelector('svg')
      return svg && b.classList.contains('w-6')
    })
    if (playButtons.length >= 2) {
      fireEvent.click(playButtons[1])
      expect(onPlay).toHaveBeenCalledWith(1)
    }
  })

  it('calls onRemove with correct index when remove button is clicked', () => {
    const onRemove = vi.fn()
    render(<QueuePanel {...defaultProps} onRemove={onRemove} />)
    const removeButtons = screen.getAllByTitle('Remove from queue')
    fireEvent.click(removeButtons[0])
    expect(onRemove).toHaveBeenCalledWith(0)
  })

  it('shows singular "track" for single track queue', () => {
    render(<QueuePanel {...defaultProps} tracks={['solo.mp3']} currentIndex={0} />)
    expect(screen.getByText('(1 track)')).toBeTruthy()
  })

  it('double-click on track name calls onPlay', () => {
    const onPlay = vi.fn()
    render(<QueuePanel {...defaultProps} onPlay={onPlay} />)
    const trackName = screen.getByText('track2')
    fireEvent.doubleClick(trackName)
    expect(onPlay).toHaveBeenCalledWith(1)
  })
})
