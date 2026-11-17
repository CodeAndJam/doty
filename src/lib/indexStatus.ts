/**
 * What to say about the library index, in one place.
 *
 * The same numbers appear twice — a chip in the browser header and a line in
 * Settings — and they must never disagree about whether work is happening.
 */
import type { IndexProgress } from '../types'

/** The chip is silent when there is nothing to say. */
/** True when there is still work, so a pause is worth mentioning. */
function hasWork(status: IndexProgress): boolean {
  return status.phase !== 'idle' || status.indexed < status.total
}

export function indexChipText(status: IndexProgress | null): string | null {
  if (!status) return null
  // Recording pauses a run that is in flight; a complete index is not "paused".
  if (status.paused && hasWork(status)) return 'paused · recording'
  if (status.phase === 'idle') return null
  return status.phaseTotal > 0
    ? `indexing ${status.phase} ${status.phaseDone}/${status.phaseTotal}`
    : `indexing ${status.phase}`
}

/** The Settings line: what exists, what is left, and why it may be stopped. */
export function indexSummary(status: IndexProgress | null): string {
  if (!status) return 'Index status unavailable'
  if (!status.ready) return 'Embedding model not installed — search falls back to text'
  const base = `${status.indexed} of ${status.total} embedded`
  if (status.paused && hasWork(status)) return `${base} — paused while recording`
  if (status.phase === 'text' || status.phase === 'audio') {
    return `${base} — ${status.phase} pass, ${status.phaseDone}/${status.phaseTotal}`
  }
  return status.indexed < status.total ? `${base} — waiting to start` : `${base} — complete`
}
