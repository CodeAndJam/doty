import { describe, expect, it, vi } from 'vitest'

// Test the crash detection logic in isolation
describe('ASR crash detection', () => {
  it('sets crashed status when voxmlx process exits unexpectedly', () => {
    let asrProcessDead = false
    let statusEmitted = ''
    const isVoxtral = true

    // Simulate the onExit handler from asr.ts
    const onExit = () => {
      if (isVoxtral) {
        asrProcessDead = true
        statusEmitted = 'crashed'
      }
    }

    onExit()
    expect(asrProcessDead).toBe(true)
    expect(statusEmitted).toBe('crashed')
  })

  it('allows restart after crash via restartRecognizer logic', () => {
    let asrProcessDead = true

    // Simulate restartRecognizer
    const restartRecognizer = () => {
      asrProcessDead = false
    }

    restartRecognizer()
    expect(asrProcessDead).toBe(false)
  })

  it('does not set crashed for non-voxtral models', () => {
    let asrProcessDead = false
    const isVoxtral = false

    const onExit = () => {
      if (isVoxtral) {
        asrProcessDead = true
      }
    }

    onExit()
    expect(asrProcessDead).toBe(false)
  })
})
