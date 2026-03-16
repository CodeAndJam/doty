import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Transcript from '../../components/Transcript'

const line = (text: string, draft = false) => ({ text, draft })

describe('Transcript', () => {
  it('shows placeholder when empty and not recording', () => {
    render(<Transcript lines={[]} recording={false} />)
    expect(screen.getByText('Await the spoken word.')).toBeInTheDocument()
  })

  it('shows listening message when empty and recording', () => {
    render(<Transcript lines={[]} recording={true} />)
    expect(screen.getByText('The construct listens...')).toBeInTheDocument()
  })

  it('renders transcript lines', () => {
    render(<Transcript lines={[line('Hello world'), line('Second line')]} recording={false} />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
    expect(screen.getByText('Second line')).toBeInTheDocument()
  })

  it('shows Inscribing indicator when recording', () => {
    render(<Transcript lines={[]} recording={true} />)
    expect(screen.getByText('Inscribing')).toBeInTheDocument()
  })

  it('does not show Inscribing indicator when not recording', () => {
    render(<Transcript lines={[]} recording={false} />)
    expect(screen.queryByText('Inscribing')).not.toBeInTheDocument()
  })

  it('renders multiple lines correctly', () => {
    const lines = [line('Line 1'), line('Line 2'), line('Line 3')]
    render(<Transcript lines={lines} recording={false} />)
    expect(screen.getByText('Line 1')).toBeInTheDocument()
    expect(screen.getByText('Line 2')).toBeInTheDocument()
    expect(screen.getByText('Line 3')).toBeInTheDocument()
  })

  it('renders draft lines with italic style', () => {
    render(<Transcript lines={[line('Draft text', true), line('Final text', false)]} recording={false} />)
    const draft = screen.getByText('Draft text')
    const final = screen.getByText('Final text')
    expect(draft).toHaveStyle({ fontStyle: 'italic' })
    expect(final).toHaveStyle({ fontStyle: 'normal' })
  })
})
