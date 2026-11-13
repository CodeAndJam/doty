/**
 * Deciding music-or-effect from embeddings, and planning the move.
 *
 * The classifier we ship today uses duration: seconds is an effect, minutes is a
 * cue. That is reliable but blunt — a 30-second loop is `unknown`, and a sting
 * that runs 40 seconds is misread. EmbeddingGemma 2 puts text and audio in one
 * space, so the honest version asks two questions of the audio and compares:
 *
 *     "a background music track for a scene"   vs
 *     "a short sound effect: a door, a hit, a roar"
 *
 * Whichever the sound sits nearer to wins — but only if the margin is real. The
 * rule below is deliberately conservative: an unsettled answer stays `uncertain`
 * and the file keeps its place, because silently moving a DM's cue into the
 * effects shelf is worse than leaving it where they put it.
 */

export type AudioKind = 'music' | 'sfx' | 'uncertain'

/** The two descriptions an audio vector is compared against, in one shared space. */
export const KIND_QUERIES: Record<Exclude<AudioKind, 'uncertain'>, string> = {
  music: 'a background music track for a roleplaying scene',
  sfx: 'a short sound effect: a door, a sword hit, a monster roar',
}

/** How far apart the two scores must be before a move is justified. */
export const KIND_MARGIN = 0.03

export interface KindDecision {
  kind: AudioKind
  /** Absolute gap between the two scores, for logging and for a UI hint. */
  margin: number
  reason: string
}

export function decideKind(musicScore: number, sfxScore: number, margin = KIND_MARGIN): KindDecision {
  const gap = Math.abs(musicScore - sfxScore)
  if (!Number.isFinite(gap)) return { kind: 'uncertain', margin: 0, reason: 'no usable audio embedding' }
  if (gap < margin) {
    return { kind: 'uncertain', margin: gap, reason: 'the sound sits between an effect and a cue' }
  }
  const kind: AudioKind = musicScore > sfxScore ? 'music' : 'sfx'
  return {
    kind,
    margin: gap,
    reason: kind === 'music' ? 'closer to a cue than to an effect' : 'closer to an effect than to a cue',
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
  const trimmed = root.replace(/[\\/]+$/, '')
  return `${trimmed}/${basename}`
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
