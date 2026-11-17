/** `Session 16 Nov 09:06` — enough to recognise a table without typing. */
export function defaultSessionName(now = new Date()): string {
  const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `Session ${date} ${time}`
}
