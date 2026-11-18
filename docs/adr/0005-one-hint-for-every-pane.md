# The hint is one text, and all three panes read it

The DM's prompt box already fed music and effects from a single call
(`runDmRecommendation` composes the text once and hands it to both). Lighting needed the same
description, and the cheap way to give it one was a second field on the lights pane. That would have
made one idea into two vocabularies — the DM would type "dark and funny" once for the score and
again, differently, for the room.

So there is one **Session Hint**: the DM's words, pinned beside the transcript, read by all three
panes. This reverses the earlier lights-only plan, on purpose. The hint nudges and never decides —
the transcript still owns the Scene — and no policy constant or confidence threshold moves.

Status: accepted

## Considered Options

- **Lights-only hint, carried but ignored by the ranker.** Rejected: two text fields for one
  thought, and the lights pane would appear to own music's behaviour without owning it.
- **Let the hint set thresholds.** Rejected. `AGENTS.md` says thresholds move only against measured
  session data; a hint is a mood, not a calibration.

## Consequences

- Every hint-attributed decision is logged with `source: 'hint'`, so "does the hint help" is a row
  to read rather than an argument to have.
- Reverting to lights-only is one condition in the light path, but it would cost the DM the ability
  to describe the session once — hence the log row before the revert.
- A hint written in a language the decision model does not read falls back to keyword matching for
  all three panes at once, since it is the same text.
