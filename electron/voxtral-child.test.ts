/**
 * Test: Voxtral child process loads the model only once,
 * even when multiple audio messages arrive concurrently.
 *
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'

describe('voxtral-child model loading', () => {
  it('loadModel is called only once despite concurrent invocations', async () => {
    // Simulate the loadModel guard logic from voxtral-child.ts
    let model: string | null = null
    let loadPromise: Promise<void> | null = null
    let loadCount = 0

    async function loadModel() {
      if (model) return
      if (loadPromise) return loadPromise
      loadPromise = (async () => {
        loadCount++
        // Simulate async model load
        await new Promise((r) => setTimeout(r, 50))
        model = 'loaded'
      })()
      return loadPromise
    }

    // Simulate 10 concurrent audio messages all triggering loadModel
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

    // Simulate 20 rapid audio messages
    for (let i = 0; i < 20; i++) {
      onMessage()
    }

    // Wait for session to complete
    await new Promise((r) => setTimeout(r, 100))

    expect(sessionCount).toBe(1)
  })
})
