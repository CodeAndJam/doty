/**
 * The library: what is in it, which lane each file is on, how it is described,
 * and which of it is already embedded.
 *
 * Before this module, five call sites each assembled the same set — files, then
 * metadata, then tags, then a describer — and two of them disagreed about which
 * folder counts. Everything that needs "the library" now asks here, so the
 * describer the ranker sees is the describer retrieval indexed, and adding the
 * effects folder to the index is one list instead of a sixth call site.
 *
 * Dependencies are injected: the module takes a `LibraryDeps`, so the whole thing
 * can be driven by a fake embedder in tests, without Electron.
 */
import { describeTrack } from '../src/lib/describeTrack'
import { type Lane, type LaneSource, resolveLane } from '../src/lib/lane'
import type { TrackMeta } from '../src/types'
import { createAudioIndexer } from './session/audio/indexer'
import type { Embedder } from './session/embedder'
import { RETRIEVAL_KEY } from './session/embedder'
import { topK } from './session/embedding'
import { createIndexer } from './session/indexer'
import { type AudioKind, decideKindFor, type KindAnchors } from './session/kindDecision'
import type { SfxItem } from './sfx-library'

export interface LibraryItem {
  /** Stable identity for the vector store and the override table. */
  key: string
  /** The path the rest of the app addresses: relative to its folder. */
  path: string
  /** Where the decoder finds it. */
  absolute: string
  /** The folder it was found in, which the lane may differ from. */
  origin: Lane
  lane: Lane
  /** Why it is on that lane: the DM said so, the classifier decided, or the folder. */
  laneSource: LaneSource
  /** The text the ranker and the retrieval index both see. */
  description: string
}

export interface IndexStatus {
  /** Whether the embedding model is installed. */
  ready: boolean
  phase: 'idle' | 'text' | 'audio'
  paused: boolean
  /** Items with a text vector, over the whole library. */
  indexed: number
  total: number
  /** Progress inside the running phase. */
  phaseDone: number
  phaseTotal: number
}

export interface SearchResult {
  items: LibraryItem[]
  /** Which matcher answered, so the UI can say when it fell back. */
  mode: 'semantic' | 'text'
}

export interface LibraryDeps {
  folders(): { music: string; sfx: string }
  musicFiles(folder: string): string[]
  sfxItems(folder: string): SfxItem[]
  facts(): Record<string, TrackMeta>
  tags(): Record<string, string[]>
  overrides(): Record<string, Lane>
  setOverride(key: string, lane: Lane): void
  /** Drop the DM's label, so the classifier decides again. */
  clearOverride(key: string): void
  /** Loads the model on first use; null when it is not installed. */
  embedder(): Promise<Embedder | null>
  embedderAvailable(): boolean
  audioAvailable(): boolean
  kindAnchors(embedder: Embedder): Promise<KindAnchors | null>
  embedAudio(absolute: string, durationSeconds: number | undefined): Promise<Float32Array | null>
  store: {
    getVector(key: string, model: string): Float32Array | null
    putVector(key: string, model: string, vector: Float32Array): void
  }
  onStatus(status: IndexStatus): void
}

export interface Library {
  items(lane?: Lane): LibraryItem[]
  search(text: string, lane: Lane, k: number): Promise<SearchResult>
  status(): IndexStatus
  ensureIndexed(): Promise<void>
  pause(): void
  resume(): void
  /** Audio verdicts by library key, absent when nothing was classified. */
  kinds(): Record<string, AudioKind>
  /** The effective lane of every item, by library key. */
  lanes(): Map<string, Lane>
  setLane(key: string, lane: Lane): void
  clearLane(key: string): void
}

export function createLibrary(deps: LibraryDeps): Library {
  let phase: IndexStatus['phase'] = 'idle'
  let paused = false
  let running = false
  /** A library change during a run: finish it, then start again on the new one. */
  let rerun = false
  let phaseDone = 0
  let phaseTotal = 0
  let kinds: Record<string, AudioKind> = {}
  let wake: (() => void) | null = null

  function items(lane?: Lane): LibraryItem[] {
    const { music, sfx } = deps.folders()
    const facts = deps.facts()
    const tags = deps.tags()
    const overrides = deps.overrides()
    const out: LibraryItem[] = []

    const pick = (key: string, path: string, absolute: string, folderLane: Lane, meta?: TrackMeta, extra = '') => {
      const description = extra || describeTrack(path, meta, tags[path] ?? tags[absolute] ?? [])
      const decision = resolveLane({
        path,
        folderLane,
        override: overrides[key] ?? null,
        duration: meta?.duration,
        genre: meta?.genre,
        audio: meta?.audioKind,
      })
      // shortcut: effects have no measured duration yet (B2), so a name-only
      // verdict must not move them off the shelf they were put on. Remove this
      // once the scanner measures effect durations.
      const nameOnly = folderLane === 'sfx' && !meta?.duration && !meta?.audioKind
      const lane = nameOnly && decision.source === 'classifier' ? 'sfx' : decision.lane
      const source = lane === decision.lane ? decision.source : 'folder'
      out.push({
        key,
        path,
        absolute,
        origin: folderLane,
        lane,
        laneSource: source,
        description,
      })
    }

    for (const path of music ? deps.musicFiles(music) : []) {
      pick(path, path, `${music.replace(/[\\/]+$/, '')}/${path}`, 'music', facts[path])
    }
    // One folder for both libraries is a supported setup, not a duplicate.
    if (sfx && sfx !== music) {
      for (const item of deps.sfxItems(sfx)) {
        // Effects never enter the `tracks` table, so their vectors live under a
        // prefixed key. Without it, `Ambience/rain.mp3` in both folders would be
        // one row and one vector for two different sounds.
        // shortcut: prefix instead of a canonical absolute key, so the music
        // index survives; upgrade when a second source folder lands.
        const key = `sfx:${item.id}`
        const description = [item.label, item.category, ...(tags[item.filename] ?? [])].filter(Boolean).join(', ')
        pick(key, item.id, item.filename, 'sfx', undefined, description)
      }
    }
    return lane ? out.filter((item) => item.lane === lane) : out
  }

  function counts(): { indexed: number; total: number } {
    const all = items()
    let indexed = 0
    for (const item of all) if (deps.store.getVector(item.key, RETRIEVAL_KEY)) indexed++
    return { indexed, total: all.length }
  }

  function status(): IndexStatus {
    const { indexed, total } = counts()
    return { ready: deps.embedderAvailable(), phase, paused, indexed, total, phaseDone, phaseTotal }
  }

  function emit(): void {
    deps.onStatus(status())
  }

  /** The expensive calls go through here, so a pause holds work without touching the indexers. */
  async function gate<T>(work: () => Promise<T>): Promise<T> {
    while (paused) await new Promise<void>((resolve) => (wake = resolve))
    return work()
  }

  async function ensureIndexed(): Promise<void> {
    if (running) {
      rerun = true
      return
    }
    running = true
    try {
      const embedder = await deps.embedder()
      if (!embedder) return
      const all = items()
      const byKey = new Map(all.map((item) => [item.key, item]))
      const describe = (key: string) => byKey.get(key)?.description ?? ''

      phase = 'text'
      phaseDone = 0
      phaseTotal = 0
      emit()
      await createIndexer({
        paths: () => all.map((item) => item.key),
        store: deps.store,
        embed: (texts) => gate(() => embedder.embedDocuments(texts)),
        model: RETRIEVAL_KEY,
        // Exactly the text the ranker judges, so a retrieved track is one the
        // model was also shown.
        describe,
        batch: 8,
        onProgress: (p) => {
          phaseDone = p.done
          phaseTotal = p.total
          emit()
        },
      }).run()

      if (deps.audioAvailable()) {
        const anchors = await deps.kindAnchors(embedder)
        if (anchors) {
          phase = 'audio'
          phaseDone = 0
          phaseTotal = 0
          emit()
          const facts = deps.facts()
          const audio = createAudioIndexer({
            paths: () => all.map((item) => item.key),
            store: deps.store,
            embed: (key) =>
              gate(() => {
                const item = byKey.get(key)
                return item ? deps.embedAudio(item.absolute, facts[item.path]?.duration) : Promise.resolve(null)
              }),
            classify: (vector) => decideKindFor(vector, anchors).kind,
            onProgress: (p) => {
              phaseDone = p.done
              phaseTotal = p.total
              emit()
            },
          })
          await audio.run()
          kinds = audio.kinds
        }
      }
    } finally {
      running = false
      phase = 'idle'
      phaseDone = 0
      phaseTotal = 0
      emit()
      if (rerun) {
        rerun = false
        void ensureIndexed().catch((e) => console.error('[library] rerun failed:', e))
      }
    }
  }

  async function search(text: string, lane: Lane, k: number): Promise<SearchResult> {
    const pool = items(lane)
    const query = text.trim()
    if (!query) return { items: [], mode: 'text' }

    const embedder = await deps.embedder()
    // Semantic only when it can answer for every track on this lane: a partial
    // index hides tracks silently, which is worse than answering by name.
    const fullyIndexed =
      embedder !== null &&
      pool.length > 0 &&
      pool.every((item) => deps.store.getVector(item.key, RETRIEVAL_KEY) !== null)

    if (!embedder || !fullyIndexed) return { items: textSearch(pool, query, k), mode: 'text' }

    const vectors = new Map<string, Float32Array>()
    for (const item of pool) {
      const vector = deps.store.getVector(item.key, RETRIEVAL_KEY)
      if (vector) vectors.set(item.key, vector)
    }
    const byKey = new Map(pool.map((item) => [item.key, item]))
    const ranked = topK(await embedder.embedQuery(query), vectors, k).map((key) => byKey.get(key)!)

    // A name match is a fact, not an opinion: keep exact hits ahead of the
    // ordering rather than asking the model to rediscover them.
    const named = textSearch(pool, query, k)
    const pinned = named.filter((item) => !ranked.includes(item))
    return { items: [...pinned, ...ranked].slice(0, k), mode: 'semantic' }
  }

  return {
    items,
    search,
    status,
    ensureIndexed,
    pause() {
      paused = true
      emit()
    },
    resume() {
      paused = false
      emit()
      wake?.()
      wake = null
    },
    kinds: () => kinds,
    lanes: () => new Map(items().map((item) => [item.key, item.lane])),
    setLane(key, lane) {
      deps.setOverride(key, lane)
      emit()
    },
    clearLane(key) {
      deps.clearOverride(key)
      emit()
    },
  }
}

/** Every word in the query has to appear: the same rule the browse panels had. */
function textSearch(pool: LibraryItem[], query: string, k: number): LibraryItem[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const exact = query.toLowerCase()
  const matches = pool.filter((item) => {
    const haystack = item.description.toLowerCase()
    return tokens.every((token) => haystack.includes(token))
  })
  return matches
    .sort(
      (a, b) =>
        Number(b.description.toLowerCase().includes(exact)) - Number(a.description.toLowerCase().includes(exact)),
    )
    .slice(0, k)
}
