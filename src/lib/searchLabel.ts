/**
 * What the search box says about how it answered.
 *
 * The DM should not have to know which matcher ran, but they should be told when
 * the answer came from the weaker one and why — otherwise a fallback looks like
 * the search being bad at its job.
 */
import type { IndexProgress } from '../types'

export type SearchMode = 'semantic' | 'text'

export function searchModeLabel(mode: SearchMode, status: IndexProgress | null): string {
  // The DM's words, not the model's: "semantic" names a mechanism they did not
  // ask for, and "text search" alone does not say why.
  if (mode === 'semantic') return 'best match'
  if (!status) return 'by name'
  if (!status.ready) return 'by name — no embedding model'
  if (status.indexed < status.total) return `by name — index ${status.indexed}/${status.total}`
  return 'by name'
}
