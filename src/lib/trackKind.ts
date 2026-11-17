/**
 * Is this file music, or a sound effect that ended up in the music folder?
 *
 * Libraries get mangled: a "Sounds" pack dropped next to the score, or one
 * folder holding both. A four-second door slam in the candidate list wastes one
 * of twenty slots and can never fit a scene, so it is worth separating without
 * asking the user to sort their disk.
 *
 * Duration is the honest signal: effects are seconds, cues are minutes. Genre and
 * path are used when duration is missing or ambiguous, and a file that looks like
 * neither is left `unknown` rather than guessed — misrouting a real cue into the
 * effects shelf is worse than leaving it where it is.
 *
 * An audio-embedding verdict, when the library has one, fills exactly that middle
 * band (20–45 s). It does *not* override a duration that already decides: on the
 * real library its confident mistakes are all long ambience cues — a campfire or
 * a rain loop genuinely sounds like a sound effect — and demoting a DM's scene
 * bed to the effects shelf is the expensive error.
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
  const genre = (input.genre ?? '').trim()
  // The tagger writes "Music" when it has nothing better, so it is a weak hint at
  // best: only a *specific* genre word counts as evidence below.
  const path = input.path.replace(/\\/g, '/')

  const namedSfx = SFX_WORDS.test(path)
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

  // The only band duration cannot answer: a loop or a sting bed. The sound itself
  // is better evidence than a folder name, when the model has an opinion.
  if (input.audio === 'music' || input.audio === 'sfx') return input.audio

  // No duration, or an undecided audio verdict: fall back to names.
  if (namedSfx) return 'sfx'
  if (namedMusic) return 'music'
  return 'unknown'
}
