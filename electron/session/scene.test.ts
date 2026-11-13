import { describe, expect, it } from 'vitest'
import { foldScene, type Scene } from './scene'

const cfg = { minDwellMs: 60_000, confirmations: 2 }
const t0 = 1_000_000
const calm = { mood: 'peaceful', intensity: 0.2, probability: 0.8 }

describe('foldScene', () => {
  it('adopts the first observation', () => {
    const scene = foldScene(null, calm, t0, cfg)
    expect(scene.mood).toBe('peaceful')
    expect(scene.since).toBe(t0)
  })

  it('ignores a single blip so the score does not flicker', () => {
    const first = foldScene(null, calm, t0, cfg)
    const blip = foldScene(first, { mood: 'combat', intensity: 0.9, probability: 0.7 }, t0 + 10_000, cfg)
    expect(blip.mood).toBe('peaceful')
    expect(blip.candidate?.mood).toBe('combat')
  })

  it('switches once the new mood repeats', () => {
    let scene: Scene = foldScene(null, calm, t0, cfg)
    scene = foldScene(scene, { mood: 'combat', intensity: 0.9, probability: 0.8 }, t0 + 10_000, cfg)
    scene = foldScene(scene, { mood: 'combat', intensity: 0.9, probability: 0.85 }, t0 + 76_000, cfg)
    expect(scene.mood).toBe('combat')
    expect(scene.since).toBe(t0 + 76_000)
  })

  it('will not switch before the minimum dwell, however confident', () => {
    const first = foldScene(null, calm, t0, cfg)
    const early = foldScene(first, { mood: 'combat', intensity: 1, probability: 0.99 }, t0 + 5_000, cfg)
    const again = foldScene(early, { mood: 'combat', intensity: 1, probability: 0.99 }, t0 + 8_000, cfg)
    expect(again.mood).toBe('peaceful')
  })

  it('drops a stale candidate when a third mood arrives', () => {
    let scene: Scene = foldScene(null, calm, t0, cfg)
    scene = foldScene(scene, { mood: 'combat', intensity: 0.9, probability: 0.8 }, t0 + 10_000, cfg)
    scene = foldScene(scene, { mood: 'horror', intensity: 0.5, probability: 0.7 }, t0 + 80_000, cfg)
    expect(scene.mood).toBe('peaceful')
    expect(scene.candidate).toEqual({ mood: 'horror', count: 1 })
  })

  it('keeps the original start time while the mood holds', () => {
    let scene: Scene = foldScene(null, calm, t0, cfg)
    scene = foldScene(scene, { mood: 'peaceful', intensity: 0.4, probability: 0.9 }, t0 + 30_000, cfg)
    expect(scene.since).toBe(t0)
    expect(scene.intensity).toBeCloseTo(0.4, 6)
  })
})
