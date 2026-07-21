/**
 * embedding-queue.ts — Background queue for generating track embeddings.
 * Throttled, pauseable, respects STT priority. Tags-first, LLM-lazy.
 */

import { getTags } from './database'
import { isEmbeddingModelReady, requestEmbedding } from './scene-interpreter'
import { getEmbeddingStats, getTracksNeedingEmbedding, upsertTrackEmbedding } from './track-vectors'

const COOLDOWN_MS = 500 // pause between tracks to avoid heat
const _BATCH_SIZE = 10 // process this many before re-checking state

let running = false
let paused = false
let allFiles: string[] = []
let onProgress: ((stats: { embedded: number; total: number; percent: number }) => void) | null = null
let pendingEmbedCallback: ((id: number, vector: number[]) => void) | null = null
let currentEmbedId = 0
let timer: ReturnType<typeof setTimeout> | null = null

export function setEmbeddingFiles(files: string[]): void {
  allFiles = files
}

export function setOnEmbeddingProgress(
  cb: (stats: { embedded: number; total: number; percent: number }) => void,
): void {
  onProgress = cb
}

/** Pause embedding (e.g., when STT starts) */
export function pauseEmbedding(): void {
  paused = true
}

/** Resume embedding (e.g., when STT stops) */
export function resumeEmbedding(): void {
  paused = false
  if (running) scheduleNext()
}

/** Start the background embedding queue */
export function startEmbeddingQueue(): void {
  if (running) return
  running = true
  scheduleNext()
}

/** Stop the queue */
export function stopEmbeddingQueue(): void {
  running = false
  paused = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function scheduleNext(): void {
  if (!running || paused) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(processNext, COOLDOWN_MS)
}

async function processNext(): Promise<void> {
  if (!running || paused) return
  if (!isEmbeddingModelReady()) {
    // Wait for embedding model to load
    scheduleNext()
    return
  }

  const needsWork = getTracksNeedingEmbedding(allFiles, 1)
  if (needsWork.length === 0) {
    // All done
    running = false
    reportProgress()
    return
  }

  const filename = needsWork[0]
  const tags = getTags(filename)

  // Tags-first: if track has tags, embed directly without LLM
  const description = buildDescription(filename, tags)

  // Request embedding from the LLM utilityProcess
  const embedId = ++currentEmbedId

  // Set up one-shot callback for this embedding
  const originalCb = pendingEmbedCallback
  pendingEmbedCallback = (id: number, vector: number[]) => {
    if (id !== embedId) return
    pendingEmbedCallback = originalCb
    const source = tags.length > 0 ? ('tags' as const) : ('llm' as const)
    upsertTrackEmbedding(filename, description, vector, source)
    reportProgress()
    scheduleNext()
  }

  requestEmbedding(embedId, `search_document: ${description}`)
}

/** Build a text description for embedding (tags-first, fallback to filename) */
function buildDescription(filename: string, tags: string[]): string {
  const name = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
  if (tags.length > 0) {
    return `${name}. Tags: ${tags.join(', ')}`
  }
  // No tags — just use cleaned filename (LLM description will replace this later)
  return name
}

function reportProgress(): void {
  if (onProgress) {
    const stats = getEmbeddingStats(allFiles.length)
    onProgress(stats)
  }
}

/** Handle embedding result from the LLM process */
export function handleEmbeddingResult(id: number, vector: number[]): void {
  if (pendingEmbedCallback) {
    pendingEmbedCallback(id, vector)
  }
}
