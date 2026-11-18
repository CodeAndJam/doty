import { describe, expect, it } from 'vitest'
import { SpeakerLabels } from './labels'

describe('SpeakerLabels', () => {
  it('freezes the label at first sight and reuses it', () => {
    const labels = new SpeakerLabels()
    expect(labels.label('u1', 'Cabeda')).toBe('Cabeda')
    expect(labels.label('u1', 'Renamed Mid-Session')).toBe('Cabeda')
  })

  it('separates two people with the same display name', () => {
    const labels = new SpeakerLabels()
    expect(labels.label('u1', 'Cabeda')).toBe('Cabeda')
    expect(labels.label('u2', 'Cabeda')).toBe('Cabeda (2)')
    expect(labels.label('u3', 'Cabeda')).toBe('Cabeda (3)')
  })

  it('numbers speakers it cannot name, in the order they were heard', () => {
    const labels = new SpeakerLabels()
    expect(labels.label('u9', '')).toBe('Remote 1')
    expect(labels.label('u4', '   ')).toBe('Remote 2')
  })

  it('forgets everyone when the call ends', () => {
    const labels = new SpeakerLabels()
    labels.label('u1', 'Cabeda')
    labels.reset()
    expect(labels.label('u2', 'Cabeda')).toBe('Cabeda')
  })
})
