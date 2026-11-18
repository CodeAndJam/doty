/** Discord rejects a message body longer than this. */
export const DISCORD_MESSAGE_LIMIT = 2000

/**
 * Pack finished transcript lines into as few messages as the limit allows, so a
 * batch of short lines is one notification instead of five.
 */
export function chunkLines(lines: string[], limit = DISCORD_MESSAGE_LIMIT): string[] {
  const messages: string[] = []
  let current = ''

  for (const raw of lines) {
    for (const piece of splitLongLine(raw, limit)) {
      if (current.length === 0) {
        current = piece
      } else if (current.length + 1 + piece.length <= limit) {
        current = `${current}\n${piece}`
      } else {
        messages.push(current)
        current = piece
      }
    }
  }
  if (current.length > 0) messages.push(current)
  return messages
}

/** A single line nobody could split at a boundary still has to fit. */
function splitLongLine(line: string, limit: number): string[] {
  if (line.length <= limit) return [line]
  const pieces: string[] = []
  for (let i = 0; i < line.length; i += limit) pieces.push(line.slice(i, i + limit))
  return pieces
}
