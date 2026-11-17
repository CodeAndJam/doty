# End goal: the DM never touches Doty

A hybrid session is a real table: six people in a room, a laptop mic, a Discord
call, music coming out of the same speakers the mic can hear. Doty is finished
for a session when **the DM can run it for three hours and never touch it for
music or effects**.

That is the bar every change is judged against. A suggestion the DM has to act
on is a defect; a track they have to skip is a defect; silence between cues is a
defect; a confident wrong effect is worse than a missed one.

## Definition of done

- Music never falls silent by accident. The default is loop-single: a cue that
  fits keeps playing. Autopilot replaces it only when the next pick is clearly
  ahead, or the scene changed categorically.
- Changes happen at boundaries. Mid-track replacement only for a categorical
  scene change (calm → combat), and only when the model is sure.
- Suggestions are worth the glance: the DM accepts one of the first three often
  enough that scanning them is faster than choosing from the library.
- Effects fire only when the transcript clearly describes one, never during
  narration.
- Speech recognition keeps up in the room, without inventing text during music
  or silence.
- Everything is local. The only network use is a one-time model download.
- If the model is missing, the app runs on keywords and says so in the UI.
  Nothing blocks playback.

## Metrics

Each number has exactly one way to produce it, so a claim can be checked.

| # | metric | how | current | target |
|---|---|---|---|---|
| 1 | **top-1** — the model's first pick matched the DM's | `pnpm ranker:eval` | **31.8%** (7/22 decided rows) | ≥50% |
| 2 | **top-3** — the pick was on the first screen | `pnpm ranker:eval` | **31.8%** | ≥70% |
| 3 | **recall** — the pick was among the twenty offered | `pnpm ranker:eval` | **84.6%** (4 misses / 26) | ≥95% |
| 4 | **sensible boundary** — a new cue queued for a clear reason, or the cue repeated | `pnpm ranker:headless` | 3 change / 47 repeat (50 snapshots) | no unexplained change |
| 5 | **auto-change retention** — auto picks not skipped within 30 s | session log (instrumented, not yet measured) | unknown | ≥80% |
| 6 | **override rate** — manual picks ÷ decisions | session report chip | unknown | <0.3 |
| 7 | **time to first manual pick** | session log | unknown | >10 min |
| 8 | **STT WER in the room** | `docs/QUALITY.md` fixture | synthetic only; VAD emits 0.00 s on music/noise/silence | <15%, no lyric text in silence |
| 9 | **SFX precision** — auto-fired effects the DM keeps | session log | unknown | ≥95% |

Metrics 5–7 need real sessions; they are recorded from the first session and
must not be guessed. Metrics 8–9 need fixtures that do not exist yet. Do not
tune a threshold on intuition: change one only against these numbers.

## What the current numbers mean

- **Top-1 went from 0/24 to 7/22** by fixing what the model is shown: the folder
  taxonomy, tempo/mode/duration/energy in words, and an energy metric that was
  clamped to 1.0 on 70% of the library. The model was never the bottleneck; the
  option text was.
- **Recall fell from 92% to 85%** when the energy fix changed which tracks the
  keyword prefilter scores well. That is the open trade: the twenty offered are
  chosen by keywords, and a pick that scores poorly cannot be chosen by the
  model however good it is.
- **Candidate sets are still keyword-first.** Semantic retrieval exists and is
  indexed, but it is not yet merged into the prefilter. That is the next lever
  for recall.
- **Language is auto, with no preferred-language veto.** The language-ID model
  labels 5 of 25 real Portuguese segments as another language; a confidence veto
  would delete narration. The policy is tested and parked until a room recording
  shows the model is reliable.
- **The 0.9 gate was unreachable with twenty options**, so autopilot silently
  never acted. It now gates boundaries at a reachable 0.40 with a 1.5x margin
  (0.30 for a categorical scene change), and 0.9 with a 2x margin for cutting a
  track short. A hold is safe because the player repeats the current cue by
  default; it is not silence.

## The loop, in one paragraph

The transcript is embedded and matched against the library; keywords and energy
bands keep the twenty candidates the model can see. The decision model ranks
them and names the scene. Policy decides *when*: at a boundary always, mid-track
only on a categorical change with a clear margin. Manual picks, queue picks and
skips are recorded; skips are stored as rejections, never as preferences. When
the model is undecided, history breaks the tie; a track skipped twice in the
same scene stops being offered. Every change is logged so the override rate can
be read back.

## Deliberately out of scope

- Automatic file moves: moving a DM's library is a human decision. The badge and
  the one-click move are the product.
- Cloud, telemetry, and per-user accounts.
