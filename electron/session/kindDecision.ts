/**
 * Deciding music-or-effect from embeddings.
 *
 * The question this asks is binary: does the sound identify as music, or does it
 * identify as everything else — an effect, an ambience loop, a weather bed? Two
 * text descriptions are embedded into the same space as the track, and whichever
 * is nearer wins. Duration is not part of this decision; it is only the fallback
 * for a file the audio pass has not reached yet.
 *
 * The music description is deliberately a *cue* ("melody and rhythm"), while the
 * other side names environmental audio and says "no melody". On the real library
 * that contrast is what pulls a rain loop away from the score without dragging
 * composed cues with it.
 */

import { cosine } from './embedding'

export type AudioKind = 'music' | 'sfx' | 'uncertain'

/** The two descriptions an audio vector is compared against, in one shared space. */
export const KIND_QUERIES: Record<Exclude<AudioKind, 'uncertain'>, string> = {
  music: 'instrumental background music for a fantasy scene, a score with melody and rhythm',
  sfx: 'sound effects and environmental audio: rain, wind, fire, footsteps, a door, a monster, no melody',
}

/** The two text vectors the queries above produce. */
export interface KindAnchors {
  music: Float32Array
  sfx: Float32Array
}

/**
 * How much the music description must win by before a sound is called a cue.
 * Zero is the natural boundary: nearer one description or the other. A negative
 * value would buy music more room; it is a knob for real session data, not a
 * guess to tune per library.
 */
export const MUSIC_THRESHOLD = 0

export interface KindDecision {
  kind: AudioKind
  /** Absolute gap between the two scores, for logging and for a UI hint. */
  margin: number
  reason: string
}

/** Cosine of a track against the two descriptions. */
export function kindScores(track: Float32Array, anchors: KindAnchors): { music: number; sfx: number } {
  return { music: cosine(track, anchors.music), sfx: cosine(track, anchors.sfx) }
}

/**
 * The decision for a real track vector. A vector from another model or another
 * dimension is refused outright: comparing it would produce a confident score
 * that means nothing.
 */
export function decideKindFor(track: Float32Array, anchors: KindAnchors): KindDecision {
  if (track.length !== anchors.music.length || track.length !== anchors.sfx.length) {
    return { kind: 'uncertain', margin: 0, reason: 'the audio vector and the queries are not comparable' }
  }
  const { music, sfx } = kindScores(track, anchors)
  return decideKind(music, sfx)
}

export function decideKind(musicScore: number, sfxScore: number, threshold = MUSIC_THRESHOLD): KindDecision {
  if (!Number.isFinite(musicScore) || !Number.isFinite(sfxScore)) {
    return { kind: 'uncertain', margin: 0, reason: 'no usable audio embedding' }
  }
  // A zero vector scores zero against every query. That is missing evidence, not
  // a cue, so it must not take the music side by default.
  if (musicScore === 0 && sfxScore === 0) {
    return { kind: 'uncertain', margin: 0, reason: 'no usable audio embedding' }
  }
  const gap = musicScore - sfxScore
  const kind: AudioKind = gap >= threshold ? 'music' : 'sfx'
  return {
    kind,
    margin: Math.abs(gap),
    reason: kind === 'music' ? 'nearer a music cue than an effect' : 'nearer an effect than a music cue',
  }
}

/**
 * Where a file goes when the DM moves it by hand. Kept pure: the caller owns the
 * filesystem, this owns the naming rule, including not overwriting a teammate.
 */
export function moveDestination(
  basename: string,
  target: 'music' | 'sfx',
  roots: { music: string; sfx: string },
): string {
  const root = target === 'music' ? roots.music : roots.sfx
  if (!root) return ''
  // The basename comes from the renderer; `..` or a separator would move the
  // file outside the destination folder.
  const safe = basename.replace(/[\\/]/g, '').trim()
  if (!safe || safe === '.' || safe === '..') return ''
  const trimmed = root.replace(/[\\/]+$/, '')
  return `${trimmed}/${safe}`
}

/** `roar.wav` collided → `roar (2).wav`, matching what a file manager would do. */
export function disambiguate(basename: string, taken: (candidate: string) => boolean): string {
  if (!taken(basename)) return basename
  const dot = basename.lastIndexOf('.')
  const stem = dot > 0 ? basename.slice(0, dot) : basename
  const ext = dot > 0 ? basename.slice(dot) : ''
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!taken(candidate)) return candidate
  }
  return basename
}
