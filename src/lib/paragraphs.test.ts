import { describe, expect, it } from 'vitest'
import { groupParagraphs } from './paragraphs'

const line = (text: string, speaker?: string) => ({ text, speaker })

describe('groupParagraphs', () => {
  it('keeps one speaker in one paragraph', () => {
    const groups = groupParagraphs([line('a', 'Ana'), line('b', 'Ana')])
    expect(groups).toHaveLength(1)
    expect(groups[0].map((s) => s.text)).toEqual(['a', 'b'])
  })

  it('splits when the speaker changes, even with nothing else between', () => {
    const groups = groupParagraphs([line('remote one', 'Ana'), line('mine'), line('remote two', 'Ana')])
    expect(groups).toHaveLength(3)
    expect(groups.map((g) => g[0].speaker)).toEqual(['Ana', undefined, 'Ana'])
  })

  it('still honours the silence marker and system messages', () => {
    const groups = groupParagraphs([
      { text: 'one', paragraphStart: false },
      { text: '', paragraphStart: true },
      { text: 'two' },
      { text: 'model switched', system: true },
      { text: 'three' },
    ])
    expect(groups).toHaveLength(4)
    expect(groups[0][0].text).toBe('one')
    expect(groups[1].map((s) => s.text)).toEqual(['', 'two'])
    expect(groups[2][0].system).toBe(true)
    expect(groups[3][0].text).toBe('three')
  })
})
