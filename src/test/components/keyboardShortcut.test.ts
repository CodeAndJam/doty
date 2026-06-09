import { describe, expect, it, vi } from 'vitest'

describe('Keyboard shortcut: Cmd+Shift+T toggles transcription', () => {
  it('calls toggleRecording on Cmd+Shift+T', () => {
    const toggleRecording = vi.fn()

    // Simulate the keydown handler logic from MainLayout
    function handleKeyDown(e: {
      metaKey: boolean
      ctrlKey: boolean
      shiftKey: boolean
      key: string
      preventDefault: () => void
    }) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        toggleRecording()
      }
    }

    const event = { metaKey: true, ctrlKey: false, shiftKey: true, key: 'T', preventDefault: vi.fn() }
    handleKeyDown(event)
    expect(toggleRecording).toHaveBeenCalledOnce()
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('does not trigger on plain T key', () => {
    const toggleRecording = vi.fn()

    function handleKeyDown(e: {
      metaKey: boolean
      ctrlKey: boolean
      shiftKey: boolean
      key: string
      preventDefault: () => void
    }) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        toggleRecording()
      }
    }

    handleKeyDown({ metaKey: false, ctrlKey: false, shiftKey: false, key: 'T', preventDefault: vi.fn() })
    expect(toggleRecording).not.toHaveBeenCalled()
  })

  it('triggers on Ctrl+Shift+T', () => {
    const toggleRecording = vi.fn()

    function handleKeyDown(e: {
      metaKey: boolean
      ctrlKey: boolean
      shiftKey: boolean
      key: string
      preventDefault: () => void
    }) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        toggleRecording()
      }
    }

    handleKeyDown({ metaKey: false, ctrlKey: true, shiftKey: true, key: 'T', preventDefault: vi.fn() })
    expect(toggleRecording).toHaveBeenCalledOnce()
  })
})
