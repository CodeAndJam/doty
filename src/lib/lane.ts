/**
 * Which shelf a file belongs on: the score, or the effects.
 *
 * A library is not organised by folder any more. Folders are only where the
 * files came from; a "Sounds" pack dropped next to the score is normal, and one
 * folder can hold both. The lane is therefore a *label*, resolved from the
 * strongest evidence available:
 *
 *   1. the DM's own switch (an override, which always wins)
 *   2. the classifier — duration, then the audio verdict, then the name
 *   3. the folder the file was found in
 *
 * Pure, so main (indexing, candidates) and the renderer (badges) agree without
 * one asking the other.
 */
import { classifyTrack, type TrackKind } from './trackKind'

export type Lane = 'music' | 'sfx'

/** Where the answer came from, so the UI can show a track that was moved. */
export type LaneSource = 'override' | 'classifier' | 'folder'

export interface LaneDecision {
  lane: Lane
  source: LaneSource
  kind: TrackKind
}

export interface LaneFacts {
  path: string
  /** The lane of the folder the file was found in; null when there is only one. */
  folderLane?: Lane | null
  /** The DM's label for this track, when they have switched it. */
  override?: Lane | null
  duration?: number | null
  genre?: string | null
  /** Verdict from the track's audio embedding, when one exists. */
  audio?: 'music' | 'sfx' | 'uncertain'
}

export function resolveLane(facts: LaneFacts): LaneDecision {
  if (facts.override) return { lane: facts.override, source: 'override', kind: facts.override }

  const kind = classifyTrack({
    path: facts.path,
    duration: facts.duration,
    genre: facts.genre,
    audio: facts.audio,
  })
  // `unknown` means no evidence at all; the folder is then the only thing the DM
  // has said, so it wins. With one folder there is nothing to say either, and a
  // cue is the cheaper mistake: an effect in the music list wastes a slot, a cue
  // filed as an effect loses a scene bed.
  if (kind !== 'unknown') return { lane: kind, source: 'classifier', kind }
  return { lane: facts.folderLane ?? 'music', source: 'folder', kind }
}
