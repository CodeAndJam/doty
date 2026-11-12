import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

vi.mock('../components/MainLayout', () => ({ default: () => <div>main-layout</div> }))
vi.mock('../components/ModelDownload', () => ({
  default: ({ onComplete, onSkip }: { onComplete: () => void; onSkip: () => void }) => (
    <div>
      <button type="button" onClick={onComplete}>
        download
      </button>
      <button type="button" onClick={onSkip}>
        skip
      </button>
    </div>
  ),
}))

describe('App onboarding gate', () => {
  let skipModelOnboarding: ReturnType<typeof vi.fn<() => Promise<{ ok: boolean }>>>
  let status: { ready: boolean; onboardingSkipped: boolean }

  beforeEach(() => {
    skipModelOnboarding = vi.fn<() => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true })
    status = { ready: false, onboardingSkipped: false }
    Object.defineProperty(window, 'doty', {
      configurable: true,
      value: {
        modelStatus: vi.fn(() => Promise.resolve(status)),
        onModelStatus: vi.fn(() => () => {}),
        skipModelOnboarding,
      },
    })
  })

  it('shows the model screen on a fresh install', async () => {
    render(<App />)
    expect(await screen.findByText('download')).toBeTruthy()
    expect(screen.queryByText('main-layout')).toBeNull()
  })

  it('does not show the model screen again after the user skipped it', async () => {
    status = { ready: false, onboardingSkipped: true }
    render(<App />)
    expect(await screen.findByText('main-layout')).toBeTruthy()
  })

  it('persists the decision when the user starts a background download', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('download'))
    expect(await screen.findByText('main-layout')).toBeTruthy()
    expect(skipModelOnboarding).toHaveBeenCalled()
  })

  it('skips the model screen once a model is ready', async () => {
    status = { ready: true, onboardingSkipped: false }
    render(<App />)
    expect(await screen.findByText('main-layout')).toBeTruthy()
  })
})
