import { describe, expect, it } from 'vitest'
import { exportText } from '../../components/DecisionLog'

describe('exportText', () => {
  it('writes a header and one tab-separated row per decision', () => {
    const text = exportText([
      {
        timestamp: 0,
        ranker: 'model',
        confidence: 0.42,
        topTrack: 'Combat/Boss/The Enemy.mp3',
        transcriptSnippet: 'Rola iniciativa',
        action: 'play',
        reason: 'the scene changed',
      },
    ])
    const [head, row] = text.split('\n')
    expect(head).toMatch(/^time\tranker/)
    expect(row).toContain('\tmodel\tplay\tCombat/Boss/The Enemy.mp3\t42%\t')
    expect(row.endsWith('Rola iniciativa')).toBe(true)
  })

  it('keeps a tab inside a reason from breaking the columns', () => {
    const [, row] = exportText([
      {
        timestamp: 0,
        ranker: null,
        confidence: 0,
        topTrack: null,
        transcriptSnippet: '',
        action: 'hold',
        reason: 'a\tb',
      },
    ]).split('\n')
    expect(row).toContain('a b')
    expect(row.split('\t')).toHaveLength(7)
  })
})
