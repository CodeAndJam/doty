# Retrieval is text-first; the ranker's problem is what it reads

The eval settled this before we built anything expensive. On 26 labels over 50
pt-PT examples: **top-1 0/24, top-3 25%, precision@0.9 never reached**, and the
prefilter **offered 92% of the DM's picks**.

Two conclusions follow, and they point in opposite directions from where the
interesting technology is.

**Retrieval is not the bottleneck.** If 92% of the right answers were already
among the twenty candidates, a better retriever cannot move top-1. So the audio
half of EmbeddingGemma 2 — genuinely capable of embedding a track's sound — is
not the next change, however appealing it is.

**The description is the bottleneck.** Every option reads `Combat/Boss/The Enemy
— Music, 120 BPM, energy 1.0`. The `genre` column says `"Music"` on 24 tracks,
the tag table is empty, and nothing in the text says whether a track has singing,
brass, drums or a drone. The model is being asked to judge a soundtrack from a
filename.

Status: accepted

## Considered Options

- **Audio embeddings first** (`audio_encoder_q4.onnx`, 189 MB, shared space with
  text). Rejected for now, not forever: it improves *recall*, and recall was
  measured at 92%. It becomes the right change the moment a retrieval miss shows
  up in the eval, and the vector store already keys by model name, so switching
  is a re-index rather than a migration.
- **Enrich the description first** (loudness, onset rate, an instrumental flag,
  hand tags). Accepted. These are the attributes a DM actually hears, and they
  land directly in the text the ranker reads — the one input we know is thin.
- **Let the vector ordering decide.** Rejected: a chase query ranks *Ice Cavern*
  above *Heroics - Before The Storm* because the words match, while the ranker
  can see 120 BPM and energy 1.0. Cosine is for recall; the model is for
  judgement.

## Consequences

- The keyword/energy-band prefilter stays as the floor, and so does the band
  guarantee from ADR 0002 — a single mood word once hid every calm track.
- `describeTrack` now drops genre values that appear on everything (`"Music"`,
  `"Unknown"`), because a token that never varies costs budget and carries none.
- The next measurable milestone is beating **0/24 top-1** without losing the
  **92% offered**. Anything that does not move one of those two numbers is
  decoration.
- Audio embeddings remain on the board with their trigger written down: a
  retrieval miss in the eval, not a hunch.
