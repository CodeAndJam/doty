import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '../../components/Transcript'
import Transcript from '../../components/Transcript'

const sessionProps = {
  sessions: [],
  activeSession: null,
  sessionStartTime: null,
  onNewSession: () => {},
  onSwitchSession: () => {},
  onRenameSession: () => {},
  onDeleteSession: () => {},
  onCopyTranscript: () => {},
  onExportTranscript: () => {},
  availableModels: [],
}

function seg(text: string, elapsedMs = 0): TranscriptSegment {
  return { text, elapsedMs }
}

describe('Transcript', () => {
  it('shows placeholder when empty and not recording', () => {
    render(<Transcript segments={[]} recording={false} {...sessionProps} />)
    expect(screen.getByText('Await the spoken word.')).toBeInTheDocument()
  })

  it('shows listening message when empty and recording', () => {
    render(<Transcript segments={[]} recording={true} {...sessionProps} />)
    expect(screen.getByText('The construct listens...')).toBeInTheDocument()
  })

  it('renders transcript segments as flowing text', () => {
    render(<Transcript segments={[seg('Hello world'), seg('Second line')]} recording={false} {...sessionProps} />)
    // Segments in same paragraph are joined
    expect(screen.getByText('Hello world Second line')).toBeInTheDocument()
  })

  it('shows recording indicator when recording', () => {
    render(<Transcript segments={[]} recording={true} {...sessionProps} />)
    expect(screen.getByTestId('recording-indicator')).toBeInTheDocument()
  })

  it('does not show recording indicator when not recording', () => {
    render(<Transcript segments={[]} recording={false} {...sessionProps} />)
    expect(screen.queryByTestId('recording-indicator')).not.toBeInTheDocument()
  })

  it('renders system messages distinctly', () => {
    const segments: TranscriptSegment[] = [
      seg('Before switch'),
      { text: '⟳ Switched to Nemotron', elapsedMs: 0, system: true },
      seg('After switch'),
    ]
    render(<Transcript segments={segments} recording={false} {...sessionProps} />)
    expect(screen.getByText('⟳ Switched to Nemotron')).toBeInTheDocument()
    expect(screen.getByText('Before switch')).toBeInTheDocument()
    expect(screen.getByText('After switch')).toBeInTheDocument()
  })

  it('shows word count when segments have text', () => {
    render(<Transcript segments={[seg('one two three')]} recording={false} {...sessionProps} />)
    expect(screen.getByText('3 words')).toBeInTheDocument()
  })
})
