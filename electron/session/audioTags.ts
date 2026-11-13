/**
 * Tags from audio, by asking the embedding space a question.
 *
 * EmbeddingGemma 2 maps text and audio into one space, so a track's audio vector
 * can be compared against the vector of a phrase: "singing", "drums", "rain",
 * "sword clash". What comes back is how much the sound resembles the phrase — no
 * fixed taxonomy to adopt, and a vocabulary you can change without re-indexing
 * anything, because only the query text changes.
 *
 * This module is the scoring half: model-agnostic, so it is testable without a
 * single weight.
 */
import { cosine } from './embedding'

export interface TagQuery {
  phrase: string
  /** The phrase's embedding, in the same space as the audio vector. */
  vector: Float32Array
}

/**
 * Phrases the sound resembles enough to be worth saying.
 *
 * The threshold is a similarity on a shared space, not a probability: 0.25 is a
 * loose "related", 0.4 is "clearly this". Tune against real tracks, not in the
 * abstract — the ordering matters more than the absolute number.
 */
export function tagsFromAudio(audio: Float32Array, queries: TagQuery[], threshold = 0.25): string[] {
  return queries
    .map((q) => ({ phrase: q.phrase, score: cosine(audio, q.vector) }))
    .filter((t) => t.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map((t) => t.phrase)
}

/**
 * The vocabulary we ask about. Deliberately small and D&D-shaped: twelve phrases
 * cover what the ranker cannot work out from a filename, with `instrumental` the
 * one that matters most — a track with singing competes with the DM's voice.
 */
export const AUDIO_VOCABULARY = [
  'singing with lyrics',
  'instrumental music',
  'drums and percussion',
  'orchestral strings',
  'brass fanfare',
  'ambient drone',
  'rain or water',
  'fire and crackling',
  'sword fight',
  'monster roar',
  'crowd murmur',
  'solo piano',
] as const

/** The tag we act on: a vocal track is wrong under narration, whatever the mood. */
export const VOCAL_TAG = 'singing with lyrics'
