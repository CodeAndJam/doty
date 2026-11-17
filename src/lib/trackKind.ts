/**
 * Is this file music, or a sound effect that ended up in the music folder?
 *
 * Libraries get mangled: a "Sounds" pack dropped next to the score, or one
 * folder holding both. A four-second door slam in the candidate list wastes one
 * of twenty slots and can never fit a scene, so it is worth separating without
 * asking the user to sort their disk.
 *
 * The audio embedding decides first when the library has one: the sound itself is
 * the only evidence that tells a rain loop from a score. Duration, genre and path
 * are the fallback for files the audio pass has not reached — duration is never
 * used to overrule a verdict.
 */

import type { TrackMeta } from '../types'

export type TrackKind = 'music' | 'sfx' | 'unknown'

export interface TrackKindInput {
  path: string
  /** Seconds, when the scanner has it. */
  duration?: number | null
  genre?: string | null
  /** Verdict from the track's audio embedding, when one exists. */
  audio?: 'music' | 'sfx' | 'uncertain'
}

/** Below this, it cannot be a cue: no scene is scored by six seconds of audio. */
const SFX_MAX_SECONDS = 20
/** Above this, it cannot be an effect: too long to be a stab, a door or a roar. */
const MUSIC_MIN_SECONDS = 45

const SFX_WORDS = /\b(sfx|sound ?effects?|foley|stingers?|one ?shots?|ui)\b/i
const MUSIC_WORDS = /\b(music|soundtrack|score|ost|theme|ambience|ambiance)\b/i

/** The one place that maps stored metadata to the classifier's input. */
export function trackKindOf(path: string, meta: TrackMeta | undefined): TrackKind {
  return classifyTrack({ path, duration: meta?.duration, genre: meta?.genre, audio: meta?.audioKind })
}

export function classifyTrack(input: TrackKindInput): TrackKind {
  // The sound itself outranks every naming heuristic. `uncertain` means the audio
  // pass could not produce a verdict, so the fallbacks below take over.
  if (input.audio === 'music' || input.audio === 'sfx') return input.audio

  const genre = (input.genre ?? '').trim()
  const path = input.path.replace(/\\/g, '/')

  const namedSfx = SFX_WORDS.test(path)
  // The tagger writes "Music" when it has nothing better, so that exact word is
  // no evidence; a *specific* genre word is.
  const namedMusic = MUSIC_WORDS.test(genre) && !/^music$/i.test(genre)

  // A file the library itself tags as an effect stays one however long it runs:
  // rain, wind and fire loops are minutes long and still effects. Only the genre
  // is this strong — a folder named "SFX" can hold a cue.
  if (SFX_WORDS.test(genre)) return 'sfx'

  const seconds = typeof input.duration === 'number' && input.duration > 0 ? input.duration : null

  if (seconds !== null) {
    if (seconds <= SFX_MAX_SECONDS) return 'sfx'
    if (seconds >= MUSIC_MIN_SECONDS) return 'music'
  }

  // No audio verdict, no duration: fall back to names.
  if (namedSfx) return 'sfx'
  if (namedMusic) return 'music'
  return 'unknown'
}
