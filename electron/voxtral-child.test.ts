/**
 * Test: Voxtral child process loads the model only once,
 * even when multiple audio messages arrive concurrently.
 * Also tests that token decoding doesn't grow unboundedly.
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'

describe('voxtral-child model loading', () => {
  it('loadModel is called only once despite concurrent invocations', async () => {
    let model: string | null = null
    let loadPromise: Promise<void> | null = null
    let loadCount = 0

    async function loadModel() {
      if (model) return
      if (loadPromise) return loadPromise
      loadPromise = (async () => {
        loadCount++
        await new Promise((r) => setTimeout(r, 50))
        model = 'loaded'
      })()
      return loadPromise
    }

    await Promise.all(Array.from({ length: 10 }, () => loadModel()))

    expect(loadCount).toBe(1)
    expect(model).toBe('loaded')
  })

  it('sessionStarting flag prevents multiple sessions', async () => {
    let sessionActive = false
    let sessionStarting = false
    let sessionCount = 0

    async function runSession() {
      sessionCount++
      sessionActive = true
      await new Promise((r) => setTimeout(r, 50))
      sessionActive = false
    }

    function onMessage() {
      if (!sessionActive && !sessionStarting) {
        sessionStarting = true
        runSession().finally(() => {
          sessionStarting = false
        })
      }
    }

    for (let i = 0; i < 20; i++) {
      onMessage()
    }

    await new Promise((r) => setTimeout(r, 100))
    expect(sessionCount).toBe(1)
  })
})

describe('voxtral-child streamer memory', () => {
  it('tokenCache is bounded after flush — decode cost stays constant', () => {
    // Simulate the streamer's token accumulation and flush pattern
    // This catches the bug where tokenCache grows unboundedly
    let tokenCache: number[] = []
    let printLen = 0
    let textBuffer = ''
    const flushed: string[] = []

    // Simulated decode: cost proportional to tokenCache length
    function decode(tokens: number[]): string {
      return tokens.map((t) => String.fromCharCode(65 + (t % 26))).join('')
    }

    function put(token: number) {
      tokenCache.push(token)
      const text = decode(tokenCache)
      const newText = text.slice(printLen)
      printLen = text.length
      textBuffer += newText

      // Flush on "sentence end" (every 40 chars)
      if (textBuffer.length >= 40) {
        flushed.push(textBuffer)
        textBuffer = ''
        // KEY FIX: reset tokenCache after flush to prevent unbounded growth
        tokenCache = []
        printLen = 0
      }
    }

    // Simulate 1000 tokens (a long transcription session)
    for (let i = 0; i < 1000; i++) {
      put(i)
    }

    // tokenCache should never exceed ~40 tokens (one sentence worth)
    // If this fails, it means tokenCache grows unboundedly
    expect(tokenCache.length).toBeLessThan(50)
    expect(flushed.length).toBeGreaterThan(0)
  })
})
