import { describe, expect, it } from 'vitest'
import { planStep } from './director'
import { foldScene } from './scene'

const now = 1_000_000
const base = {
  now,
  msUntilTrackEnd: 15_000,
  msSinceLastChange: 600_000,
  autopilot: true,
  override: false,
}

const peaceful = { mood: 'peaceful', intensity: 0.2, moodProbability: 0.9, trackProbability: 0.6 }

describe('planStep', () => {
  it('starts with the model’s mood and picks a track at the boundary', () => {
    const step = planStep({ ...base, previous: null, observation: peaceful })
    expect(step.scene.mood).toBe('peaceful')
    expect(step.action.kind).toBe('queue-next')
  })

  it('holds when the mood is unchanged, however good the alternative', () => {
    const scene = foldScene(null, { mood: 'peaceful', intensity: 0.2, probability: 0.9 }, now)
    const step = planStep({
      ...base,
      previous: scene,
      observation: { ...peaceful, trackProbability: 0.95 },
    })
    expect(step.sameScene).toBe(true)
    expect(step.action.kind).toBe('hold')
  })

  it('does not interrupt on a mood the scene machine has not confirmed', () => {
    // One combat reading during a peaceful scene: not a scene change yet.
    const scene = foldScene(null, { mood: 'peaceful', intensity: 0.2, probability: 0.9 }, now)
    const step = planStep({
      ...base,
      msUntilTrackEnd: 200_000,
      previous: scene,
      observation: { mood: 'combat', intensity: 0.9, moodProbability: 0.8, trackProbability: 0.95 },
    })
    expect(step.scene.mood).toBe('peaceful')
    expect(step.action.kind).toBe('hold')
  })

  it('interrupts once a categorical change is confirmed and the model is sure', () => {
    let scene = foldScene(null, { mood: 'peaceful', intensity: 0.2, probability: 0.9 }, now)
    scene = foldScene(scene, { mood: 'combat', intensity: 0.9, probability: 0.8 }, now + 10_000)
    const step = planStep({
      ...base,
      now: now + 76_000,
      msUntilTrackEnd: 200_000,
      previous: scene,
      observation: { mood: 'combat', intensity: 0.9, moodProbability: 0.85, trackProbability: 0.93 },
    })
    expect(step.scene.mood).toBe('combat')
    expect(step.categorical).toBe(true)
    expect(step.action.kind).toBe('play-now')
  })

  it('keeps playing while the DM has taken over', () => {
    const step = planStep({ ...base, previous: null, observation: peaceful, override: true })
    expect(step.action.kind).toBe('hold')
    expect(step.action.reason).toMatch(/DM|playback/i)
  })
})
