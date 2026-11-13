# Decide at track boundaries, keep the scene in main

Recommendations used to be recomputed on every transcript flush and acted on at
one global threshold. That produced the two failures the goal forbids: the score
flickered, because each pass was an independent draw with no memory of the
scene, and it changed at the wrong moment, because a single 0.9 bar is both too
strict to ever pick the next track and too lax to be allowed mid-scene.

The session now has a scene (`electron/session/scene.ts`) that only changes when
a new mood repeats and the current one has had time, and a policy
(`electron/session/policy.ts`) that answers "is now a moment to change?" rather
than "is this the right track?":

- **At a boundary** (within 20 s of the end) the next track is chosen at a
  moderate probability. The track is ending anyway and the crossfade hides the
  seam, so a near-miss costs nothing.
- **Mid-track** the music is only cut for a categorical scene change (calm →
  combat), above 0.9, after the minimum dwell.
- Everything else holds, with a reason recorded for the decision log.

Main owns the scene and the policy and returns a plan; the renderer only
executes it. The renderer cannot import `electron/`, and keeping the rules in one
process stops them drifting apart. The model answers two questions per request
(mood, then track) so the scene machine gets its input for free.

Status: accepted

## Considered Options

- **One global threshold with autopilot acting any time it cleared.** Rejected:
  that is what produced mid-scene hard cuts and, at 0.9, a system that almost
  never acted.
- **Move the whole loop into main.** Rejected for now: the candidate prefilter
  (`candidateSet`) and the player live in the renderer, and moving them buys
  nothing yet. Main holds the rules; the renderer holds the audio.
- **DuckDB for embeddings and memory.** Rejected: SQLite is already here and
  open. A local library is thousands of vectors at most, so a brute-force cosine
  over BLOBs is microseconds — no vector database needed.
- **EmbeddingGemma-300M (q4 ONNX, 197 MB) for retrieval.** Accepted as the
  embedder once retrieval moves off keyword matching: 768 dimensions,
  multilingual, and small enough to sit beside the 1.5 GB ranker. Gemma licence
  terms travel with the download.

## Consequences

- The score changes at moments that sound composed, and a weak opinion no longer
  cuts a scene short.
- A wrong mood reading is absorbed by hysteresis instead of moving the music.
- Decisions are persisted with their reason, so "why didn't it switch" is a
  query, not a guess. `overrideRate` from `sessionReport` is the KPI.
- The renderer still owns the recommendation loop for suggestions; the plan is a
  second consumer of the same model call until that is unified.
