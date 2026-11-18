import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RecommendCard, { musicDetails, sfxDetails } from '../../components/RecommendCard'
import type { SfxMeta, TrackMeta } from '../../types'

const defaults = {
  kind: 'music' as const,
  title: 'tavern_ambience',
  isPlaying: false,
  isPinned: false,
  onPlay: vi.fn(),
  onPin: vi.fn(),
}

type CardProps = React.ComponentProps<typeof RecommendCard>

function renderCard(overrides: Partial<CardProps> = {}) {
  return render(<RecommendCard {...defaults} {...overrides} />)
}

describe('RecommendCard', () => {
  it('renders the title it is given', () => {
    renderCard()
    expect(screen.getByText('tavern_ambience')).toBeInTheDocument()
  })

  it('calls onPlay when play button is clicked', () => {
    const onPlay = vi.fn()
    renderCard({ onPlay })
    fireEvent.click(screen.getAllByRole('button')[0])
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

  it('stops instead of pausing on the effects shelf', () => {
    renderCard({ kind: 'sfx', isPlaying: true })
    expect(screen.getByTitle('Stop')).toBeInTheDocument()
  })

  it('renders tag pills and counts the ones it hides', () => {
    renderCard({ tags: ['combat', 'epic', 'boss'] })
    expect(screen.getByText('combat')).toBeInTheDocument()
    expect(screen.getByText('epic')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('shows the model probability only when one is given', () => {
    renderCard({ probability: 0.2 })
    expect(screen.getByTestId('track-probability')).toHaveTextContent('20%')
  })

  it('pays for one card shape: effects use the same slots', () => {
    renderCard({ kind: 'sfx', title: 'Campfire', probability: 0.42 })
    expect(screen.getByTestId('sfx-card')).toBeInTheDocument()
    expect(screen.getByTestId('sfx-probability')).toHaveTextContent('42%')
  })

  it('shows the details tooltip on hover', () => {
    renderCard({
      details: musicDetails('dark_forest/tavern_ambience.mp3', { bpm: 120, bpmConfidence: 0.9 } as TrackMeta),
    })
    fireEvent.mouseEnter(screen.getByTitle('Details').parentElement!)
    expect(screen.getByText('120 (90%)')).toBeInTheDocument()
    expect(screen.getByText('dark_forest')).toBeInTheDocument()
  })

  it('hides the details tooltip on mouse leave', () => {
    renderCard({ details: musicDetails('tavern_ambience.mp3', { bpm: 120, bpmConfidence: 0.9 } as TrackMeta) })
    const wrapper = screen.getByTitle('Details').parentElement!
    fireEvent.mouseEnter(wrapper)
    fireEvent.mouseLeave(wrapper)
    expect(screen.queryByText('120 (90%)')).toBeNull()
  })

  it('describes an effect the way an effect is filed', () => {
    const rows = sfxDetails(
      {
        id: 'sfx-1',
        label: 'Campfire',
        filename: 'ambience/campfire.mp3',
        category: 'fire',
        source: 'custom',
        duration: 8,
      } as SfxMeta,
      ['cozy'],
    )
    expect(rows).toContainEqual(['Category', 'Fire & Heat'])
    expect(rows).toContainEqual(['Tags', 'cozy'])
    expect(rows).toContainEqual(['Dir', 'ambience'])
  })
})
