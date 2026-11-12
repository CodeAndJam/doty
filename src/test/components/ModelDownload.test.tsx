import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModelDownload from '../../components/ModelDownload'

const models = [
  {
    id: 'parakeet-unified-en',
    label: 'Parakeet Unified EN (streaming)',
    description: 'Best English streaming.',
    size: '731 MB',
    streaming: true,
    languages: ['en'],
    ready: false,
  },
]

describe('ModelDownload', () => {
  let downloadModel: ReturnType<typeof vi.fn<(id?: string) => Promise<never>>>
  let onComplete: ReturnType<typeof vi.fn<() => void>>
  let onSkip: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    downloadModel = vi.fn<(id?: string) => Promise<never>>(() => new Promise(() => {})) // never resolves: the download runs in the background
    onComplete = vi.fn<() => void>()
    onSkip = vi.fn<() => void>()
    Object.defineProperty(window, 'doty', {
      configurable: true,
      value: {
        getSttModelList: vi.fn().mockResolvedValue(models),
        downloadModel,
      },
    })
  })

  it('lets the user skip without installing a model', () => {
    render(<ModelDownload onComplete={onComplete} onSkip={onSkip} />)
    fireEvent.click(screen.getByText(/Skip for now/))
    expect(onSkip).toHaveBeenCalled()
    expect(downloadModel).not.toHaveBeenCalled()
  })

  it('starts the download in the background and enters the app immediately', async () => {
    render(<ModelDownload onComplete={onComplete} onSkip={onSkip} />)
    const button = await screen.findByText(/Download Parakeet Unified EN/)
    fireEvent.click(button)
    expect(downloadModel).toHaveBeenCalledWith('parakeet-unified-en')
    // onComplete fires without waiting for the download promise to resolve
    expect(onComplete).toHaveBeenCalled()
  })
})
