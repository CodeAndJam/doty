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
 */

export type TrackKind = 'music' | 'sfx' | 'unknown'

export interface TrackKindInput {
  path: string
  /** Seconds, when the scanner has it. */
  duration?: number | null
  genre?: string | null
}

/** Below this, it cannot be a cue: no scene is scored by six seconds of audio. */
const SFX_MAX_SECONDS = 20
/** Above this, it cannot be an effect: too long to be a stab, a door or a roar. */
const MUSIC_MIN_SECONDS = 45

const SFX_WORDS = /\b(sfx|sound ?effects?|foley|stingers?|one ?shots?|ui)\b/i
const MUSIC_WORDS = /\b(music|soundtrack|score|ost|theme|ambience|ambiance)\b/i

export function classifyTrack(input: TrackKindInput): TrackKind {
  const genre = (input.genre ?? '').trim()
  // The tagger writes "Music" when it has nothing better, so it is a weak hint at
  // best: only a *specific* genre word counts as evidence below.
  const path = input.path.replace(/\\/g, '/')

  const namedSfx = SFX_WORDS.test(path) || SFX_WORDS.test(genre)
  const namedMusic = MUSIC_WORDS.test(genre) && !/^music$/i.test(genre)

  const seconds = typeof input.duration === 'number' && input.duration > 0 ? input.duration : null

  if (seconds !== null) {
    if (seconds <= SFX_MAX_SECONDS) return 'sfx'
    if (seconds >= MUSIC_MIN_SECONDS) return 'music'
  }

  // No duration, or a middling one (a loop, a stinger bed): fall back to names.
  if (namedSfx) return 'sfx'
  if (namedMusic) return 'music'
  return 'unknown'
}
