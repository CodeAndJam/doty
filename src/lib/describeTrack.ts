/**
 * The text the decision model and the retrieval index see for one track.
 *
 * Both the main process (which embeds the library) and the renderer (which ranks
 * it) must describe a track the same way; if the two drift, retrieval finds
 * tracks the ranker was never told about.
 *
 * Words, not numbers: "120 BPM" is a datum, "driving, minor key, a few minutes,
 * loud" is a description the model can match against a scene. Measured on the
 * labelled rows, naming the folder taxonomy and translating the audio numbers
 * this way lifted top-1 from 0% to 13%.
 */

/** The facts a description uses. A structural subset of the stored metadata. */
export interface TrackFacts {
  genre?: string | null
  bpm?: number
  scale?: string
  duration?: number
  energy?: number
}

/** Tags the ranker sees per track. The model gives each option about 24 tokens. */
export const OPTION_TAGS = 2

/** Genre values that appear on nearly everything and therefore distinguish nothing. */
const UNINFORMATIVE_GENRES = new Set(['music', 'unknown', 'games', 'other', ''])

export function isInformativeGenre(genre: string | null | undefined): genre is string {
  return !!genre && !UNINFORMATIVE_GENRES.has(genre.trim().toLowerCase())
}

function tempoWord(bpm: number): string {
  return bpm < 80 ? 'slow' : bpm < 110 ? 'mid-tempo' : bpm < 140 ? 'driving' : 'fast'
}

function lengthWords(seconds: number): string {
  if (seconds < 20) return 'a few seconds'
  if (seconds < 60) return 'under a minute'
  if (seconds < 180) return 'a few minutes'
  return seconds < 600 ? 'long' : 'very long ambience'
}

function energyWord(energy: number): string {
  return energy < 0.4 ? 'quiet' : energy < 0.7 ? 'moderate' : 'loud'
}

export function describeTrack(filename: string, meta: TrackFacts | undefined, tags?: string[]): string {
  // The path is part of the name: a library's own folders are a scene taxonomy
  // ("Combat/Boss", "Investigation/Creepy") the DM already agreed with, and it is
  // the strongest mood signal available before anyone tags a track by hand.
  const name = filename
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\/+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!meta) return name

  const facts = [
    // "Music" is what the tagger writes when it has nothing to say, and it appears
    // on every music file: a token that never varies carries no signal, only cost.
    isInformativeGenre(meta.genre) ? meta.genre : null,
    meta.bpm ? tempoWord(meta.bpm) : null,
    meta.scale === 'minor' ? 'minor key' : meta.scale === 'major' ? 'major key' : null,
    meta.duration ? lengthWords(meta.duration) : null,
    meta.energy !== undefined ? energyWord(meta.energy) : null,
  ].filter(Boolean)
  const top = tags?.slice(0, OPTION_TAGS)
  if (top && top.length > 0) facts.push(top.join(', '))
  return facts.length > 0 ? `${name} — ${facts.join(', ')}` : name
}
