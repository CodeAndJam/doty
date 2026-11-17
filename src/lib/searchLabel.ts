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
  if (mode === 'semantic') return 'semantic'
  if (!status) return 'text search'
  if (!status.ready) return 'text search — no embedding model'
  if (status.indexed < status.total) return `text search — index ${status.indexed}/${status.total}`
  return 'text search'
}
