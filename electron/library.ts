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
import { type Lane, type LaneSource, resolveLane, showInMusicPanel } from '../src/lib/lane'
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
  /** Every tag, for text search: the description keeps only the two the model sees. */
  tags: string[]
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
    hasVector(key: string, model: string): boolean
  }
  onStatus(status: IndexStatus): void
}

export interface Library {
  items(lane?: Lane): LibraryItem[]
  /** Search the shelf the pane on that side lists: the music folder, or every file labelled an effect. */
  search(text: string, shelf: Lane, k: number): Promise<SearchResult>
  status(): IndexStatus
  ensureIndexed(): Promise<void>
  pause(): void
  resume(): void
  /** Forget the built library: a scan, a folder change or a label changed it. */
  invalidate(): void
  /** Audio verdicts by library key, absent when nothing was classified. */
  kinds(): Record<string, AudioKind>
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
  /** Rebuilt on demand; dropped whenever the library, a label or a folder changes. */
  let cached: LibraryItem[] | null = null

  function items(lane?: Lane): LibraryItem[] {
    // A recommendation pass asks for the library while the DM is talking, and
    // building it means a walk, a tags read, an overrides read and a description
    // per track. Nothing invalidates it faster than a scan does, so it is kept
    // until something changes.
    cached ??= buildItems()
    return lane ? cached.filter((item) => item.lane === lane) : cached
  }

  function buildItems(): LibraryItem[] {
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
        audio: meta?.audioKind ?? kinds[key],
      })
      // shortcut: effects have no measured duration yet (B2), so a name-only
      // verdict must not move them off the shelf they were put on. Remove this
      // once the scanner measures effect durations.
      const nameOnly = folderLane === 'sfx' && !meta?.duration && !meta?.audioKind && !kinds[key]
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
        tags: tags[path] ?? tags[absolute] ?? [],
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
        // Duration and category are the only facts an effect has; without the
        // duration the lane rule has nothing but its name to go on.
        pick(
          key,
          item.id,
          item.filename,
          'sfx',
          { duration: item.duration, genre: item.category } as TrackMeta,
          description,
        )
      }
    }
    return out
  }

  function counts(): { indexed: number; total: number } {
    // The store is a database, and a database can be closed: quitting closes it
    // while a window event may still ask for status. Reporting nothing embedded
    // is honest; throwing here takes the whole process down.
    try {
      const all = items()
      let indexed = 0
      for (const item of all) if (deps.store.hasVector(item.key, RETRIEVAL_KEY)) indexed++
      return { indexed, total: all.length }
    } catch {
      return { indexed: 0, total: 0 }
    }
  }

  function status(): IndexStatus {
    const { indexed, total } = counts()
    return { ready: deps.embedderAvailable(), phase, paused, indexed, total, phaseDone, phaseTotal }
  }

  function emit(): void {
    // Status is a convenience; it must never be the reason the app dies.
    try {
      deps.onStatus(status())
    } catch (e) {
      console.warn('[library] status unavailable:', e instanceof Error ? e.message : e)
    }
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
          // The lanes cached so far were resolved without these verdicts.
          cached = null
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

  async function search(text: string, shelf: Lane, k: number): Promise<SearchResult> {
    // Search what the pane on that side lists: the effects shelf is the lane, and
    // the music shelf hides an effect only when an effects folder can hold it —
    // the same rule `listMusic` uses, so the box can never hide a row on screen.
    const hasSfxShelf = Boolean(deps.folders().sfx)
    const pool = items().filter((item) =>
      shelf === 'sfx' ? item.lane === 'sfx' : showInMusicPanel(item.lane, hasSfxShelf),
    )
    const query = text.trim()
    if (!query) return { items: [], mode: 'text' }

    const embedder = await deps.embedder()
    // Semantic only when it can answer for every track in the folder: a partial
    // index hides tracks silently, which is worse than answering by name.
    const fullyIndexed =
      embedder !== null && pool.length > 0 && pool.every((item) => deps.store.hasVector(item.key, RETRIEVAL_KEY))

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
    invalidate() {
      cached = null
    },
    kinds: () => kinds,
    setLane(key, lane) {
      deps.setOverride(key, lane)
      this.invalidate()
      emit()
    },
    clearLane(key) {
      deps.clearOverride(key)
      this.invalidate()
      emit()
    },
  }
}

/** Every word in the query has to appear: the same rule the browse panels had. */
function textSearch(pool: LibraryItem[], query: string, k: number): LibraryItem[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const exact = query.toLowerCase()
  const matches = pool.filter((item) => {
    const haystack = `${item.description} ${item.path} ${item.tags.join(' ')}`.toLowerCase()
    return tokens.every((token) => haystack.includes(token))
  })
  return matches
    .sort(
      (a, b) =>
        Number(b.description.toLowerCase().includes(exact)) - Number(a.description.toLowerCase().includes(exact)),
    )
    .slice(0, k)
}
