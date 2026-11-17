import { describe, expect, it } from 'vitest'
import { MOODS } from '../d1-omni'
import { createSessionPass, type PassRequest } from './pass'
import type { DecisionRow, PreferenceRow, SceneRow } from './store'

const request: PassRequest = {
  state: 'the party enters the desert',
  candidates: ['a', 'b'],
  paths: ['a.mp3', 'b.mp3'],
  msUntilTrackEnd: 200_000,
  musicEnabled: true,
}

/** A store that records what the pass wrote, so the throttle is observable. */
function recorder() {
  const scenes: SceneRow[] = []
  const decisions: DecisionRow[] = []
  return {
    scenes,
    decisions,
    store: {
      recordScene: (row: SceneRow) => scenes.push(row),
      recordDecision: (row: DecisionRow) => decisions.push(row),
      recentPreferences: (): PreferenceRow[] => [],
    },
  }
}

/** Scores with a clear margin, so the policy is free to act. */
function scores(track: number) {
  return { tracks: [track, track / 4], moods: MOODS.map((_, i) => (i === 0 ? 0.9 : 0.1 / MOODS.length)) }
}

describe('session pass', () => {
  it('records the scene only when it moves', async () => {
    const { scenes, store } = recorder()
    const pass = createSessionPass({ evaluate: async () => scores(0.95), store, now: () => 1_000 })
    await pass.run(request)
    await pass.run(request)
    expect(scenes).toHaveLength(1)
  })

  it('logs a hold at most once every 30 s', async () => {
    const { decisions, store } = recorder()
    let now = 1_000_000
    // Mid-track with the same scene: the policy holds, which is what gets logged.
    const pass = createSessionPass({ evaluate: async () => scores(0.5), store, now: () => now })
    await pass.run(request)
    now += 10_000
    await pass.run(request)
    expect(decisions).toHaveLength(1)
    now += 30_000
    await pass.run(request)
    expect(decisions).toHaveLength(2)
  })

  it('runs one pass at a time', async () => {
    const { store } = recorder()
    let inFlight = 0
    let peak = 0
    const pass = createSessionPass({
      evaluate: async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight--
        return scores(0.95)
      },
      store,
      now: () => 1_000,
    })
    await Promise.all([pass.run(request), pass.run(request), pass.run(request)])
    expect(peak).toBe(1)
  })

  it('holds everything when automatic music changes are off', async () => {
    const { store } = recorder()
    const pass = createSessionPass({ evaluate: async () => scores(0.99), store, now: () => 1_000 })
    const result = await pass.run({ ...request, musicEnabled: false })
    expect(result.plan?.action).toBe('hold')
  })

  it('starts a cue when nothing is playing', async () => {
    const { store } = recorder()
    const pass = createSessionPass({ evaluate: async () => scores(0.99), store, now: () => 1_000 })
    const result = await pass.run({ ...request, msUntilTrackEnd: null })
    expect(result.plan?.action).toBe('queue-next')
    expect(result.plan?.track).toBe('a.mp3')
  })
})
