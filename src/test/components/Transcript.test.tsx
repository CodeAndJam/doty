import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Transcript from '../../components/Transcript'

const sessionProps = {
  sessions: [],
  activeSession: null,
  sessionStartTime: null,
  onNewSession: () => {},
  onSwitchSession: () => {},
  onRenameSession: () => {},
}

describe('Transcript', () => {
  it('shows placeholder when empty and not recording', () => {
    render(<Transcript lines={[]} recording={false} {...sessionProps} />)
    expect(screen.getByText('Await the spoken word.')).toBeInTheDocument()
  })

  it('shows listening message when empty and recording', () => {
    render(<Transcript lines={[]} recording={true} {...sessionProps} />)
    expect(screen.getByText('The construct listens...')).toBeInTheDocument()
  })

  it('renders transcript lines', () => {
    render(<Transcript lines={['Hello world', 'Second line']} recording={false} {...sessionProps} />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
    expect(screen.getByText('Second line')).toBeInTheDocument()
  })

  it('does not show recording indicator in transcript panel', () => {
    render(<Transcript lines={[]} recording={true} {...sessionProps} />)
    expect(screen.queryByText('Inscribing')).not.toBeInTheDocument()
  })

  it('does not show Inscribing indicator when not recording', () => {
    render(<Transcript lines={[]} recording={false} {...sessionProps} />)
    expect(screen.queryByText('Inscribing')).not.toBeInTheDocument()
  })

  it('renders multiple lines correctly', () => {
    const lines = ['Line 1', 'Line 2', 'Line 3']
    render(<Transcript lines={lines} recording={false} {...sessionProps} />)
    lines.forEach((line) => {
      expect(screen.getByText(line)).toBeInTheDocument()
    })
  })
})
