import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Transcript from '../../components/Transcript'

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
    render(<Transcript lines={['Hello world', 'Second line']} recording={false} />)
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
    const lines = ['Line 1', 'Line 2', 'Line 3']
    render(<Transcript lines={lines} recording={false} />)
    lines.forEach((line) => expect(screen.getByText(line)).toBeInTheDocument())
  })
})
