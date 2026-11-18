import { describe, expect, it } from 'vitest'
import { chunkLines, DISCORD_MESSAGE_LIMIT } from './chat-chunk'

describe('chunkLines', () => {
  it('sends short lines together in one message', () => {
    expect(chunkLines(['dm: olá', 'Ana: olá'])).toEqual(['dm: olá\nAna: olá'])
  })

  it('starts a new message instead of exceeding the limit', () => {
    // Each line is well over half the limit, so two never fit together.
    const line = 'x'.repeat(1200)
    const messages = chunkLines([line, line, line])
    expect(messages).toHaveLength(3)
    for (const message of messages) expect(message.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT)
  })

  it('splits a single line longer than the limit rather than losing it', () => {
    const long = 'y'.repeat(DISCORD_MESSAGE_LIMIT + 50)
    const messages = chunkLines([long])
    expect(messages).toHaveLength(2)
    expect(messages.join('')).toBe(long)
    for (const message of messages) expect(message.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT)
  })

  it('drops nothing when the batch is empty', () => {
    expect(chunkLines([])).toEqual([])
  })
})
