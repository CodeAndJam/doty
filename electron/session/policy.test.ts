import { describe, expect, it } from 'vitest'
import { decideAction } from './policy'

const base = {
  now: 1_000_000,
  probability: 0.95,
  trackRatio: 3,
  sameScene: false,
  categorical: true,
  msUntilTrackEnd: 200_000,
  msSinceLastChange: 600_000,
  autopilot: true,
  override: false,
}

describe('decideAction', () => {
  it('does nothing when autopilot is off', () => {
    expect(decideAction({ ...base, autopilot: false }).kind).toBe('hold')
  })

  it('does nothing while the DM has taken playback', () => {
    expect(decideAction({ ...base, override: true }).kind).toBe('hold')
  })

  it('never interrupts mid-track on a merely better option', () => {
    // 0.62 is a good guess, not a reason to cut the current track.
    expect(decideAction({ ...base, probability: 0.62, categorical: false }).kind).toBe('hold')
  })

  it('interrupts mid-track for a categorical scene change above the high bar', () => {
    expect(decideAction(base).kind).toBe('play-now')
  })

  it('holds a categorical change just under the interrupt bar', () => {
    expect(decideAction({ ...base, probability: 0.85 }).kind).toBe('hold')
  })

  it('queues the next track at the boundary on a moderate probability', () => {
    // The track is ending anyway: being slightly wrong costs nothing.
    const at = { ...base, msUntilTrackEnd: 15_000, probability: 0.55, categorical: false }
    expect(decideAction(at).kind).toBe('queue-next')
  })

  it('holds at a boundary when nothing stands out, so the current cue repeats', () => {
    // The DM's default is loop-single. Twenty options spread probability thin, so
    // replacing a fitting cue on a weak read is the defect, not the safe choice.
    const at = { ...base, msUntilTrackEnd: 15_000, probability: 0.2, trackRatio: 1, categorical: false }
    expect(decideAction(at).kind).toBe('hold')
  })

  it('changes the cue at a boundary for a categorical scene change, even on a moderate read', () => {
    const at = { ...base, msUntilTrackEnd: 15_000, probability: 0.32, trackRatio: 1.2, categorical: true }
    expect(decideAction(at).kind).toBe('queue-next')
  })

  it('needs a clear margin to cut in mid-track, not just a decent probability', () => {
    const flat = { ...base, probability: 0.95, trackRatio: 1.1 }
    expect(decideAction(flat).kind).toBe('hold')
  })

  it('respects the minimum dwell between changes', () => {
    expect(decideAction({ ...base, msSinceLastChange: 10_000 }).kind).toBe('hold')
  })

  it('starts something when nothing is playing, even without a confident read', () => {
    // There is no cue to repeat, so a hold would be silence at the start.
    const idle = { ...base, msUntilTrackEnd: null, categorical: false, probability: 0.1, trackRatio: 1 }
    expect(decideAction(idle).kind).toBe('queue-next')
  })

  it('still picks the next track at the boundary when the scene has not changed', () => {
    // Holding here would leave dead air: the track is about to end.
    expect(decideAction({ ...base, sameScene: true, msUntilTrackEnd: 15_000 }).kind).toBe('queue-next')
  })

  it('keeps playing mid-track when the scene has not changed', () => {
    expect(decideAction({ ...base, sameScene: true, msUntilTrackEnd: 200_000 }).kind).toBe('hold')
  })

  it('says why, so the decision log is readable', () => {
    expect(decideAction({ ...base, autopilot: false }).reason).toMatch(/autopilot/i)
    expect(decideAction({ ...base, sameScene: true }).reason).toMatch(/scene/i)
  })
})
