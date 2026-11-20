import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UpdateBar from '../../components/UpdateBar'
import type { UpdateState } from '../../types'

let current: UpdateState = { status: 'idle' }
const updateInstall = vi.fn(() => Promise.resolve({ ok: true }))

beforeEach(() => {
  current = { status: 'idle' }
  updateInstall.mockClear()
  ;(window as unknown as { doty: unknown }).doty = {
    updateState: () => Promise.resolve(current),
    updateInstall,
    onUpdateState: () => () => {},
  }
})

describe('UpdateBar', () => {
  it('shows nothing until a release is offered', async () => {
    render(<UpdateBar />)
    await waitFor(() => expect(window.doty.updateState).toBeDefined())
    expect(screen.queryByTestId('update-bar')).toBeNull()
  })

  it('offers the release and installs it on click', async () => {
    current = { status: 'available', version: '5.4.0', sizeMB: 234 }
    render(<UpdateBar />)

    const bar = await screen.findByTestId('update-bar')
    expect(bar).toHaveTextContent('Doty 5.4.0 is available')

    fireEvent.click(screen.getByText(/Update & restart/))
    expect(updateInstall).toHaveBeenCalledOnce()
  })

  it('hides itself when the DM picks Later', async () => {
    current = { status: 'available', version: '5.4.0', sizeMB: 234 }
    render(<UpdateBar />)

    fireEvent.click(await screen.findByText('Later'))
    expect(screen.queryByTestId('update-bar')).toBeNull()
  })

  it('reports progress without offering a second click', async () => {
    current = { status: 'downloading', version: '5.4.0', percent: 42 }
    render(<UpdateBar />)

    expect(await screen.findByTestId('update-bar')).toHaveTextContent('Downloading Doty 5.4.0 · 42%')
    expect(screen.queryByText(/Update & restart/)).toBeNull()
  })
})
