# Model context and the DM hint (piece 1 of 3)

A DM should never touch Doty mid-session, so the decision models read a **live
window** of the room, never the session record. This piece makes that window
tunable and puts the DM's own words at its head. Pieces 2 (recall measurement)
and 3 (semantic prefilter merge) are separate; piece 3 is gated on
`pnpm ranker:eval`.

## Decisions

**The hint heads the state.** The DM's hint and the transcript tail compose as
`hint + "\n" + tail` (`src/lib/context.ts:composeState`). The hint is capped
first and protected from truncation; the transcript gets what is left. The old
path sent the hint twice to weight it, which only spent the window.

**Five budgets, one key.** `context: { windowChars, rankerChars, sfxChars,
hintChars, debounceMs }`, stored as one object, defaults in `DEFAULT_CONTEXT`,
limits in `CONTEXT_LIMITS`, clamped in main. Main is the authority: the renderer
merges locally, sends a patch, and adopts the value main returns.

**One channel pair, reused.** `settings:get-context` / `settings:set-context`
across the IPC files; no new channel per budget. The patch is decoded by the
argument schema, so an unknown field never reaches the store.

**The window is per lane.** Music reads `rankerChars`, effects read `sfxChars`,
both head with `hintChars`; the director's session pass reads the composed
state. The effects lane reads less of the room by design: a sound effect is
about the last few seconds.

**Cleared on session change, seeded on open.** The buffer is cleared on new and
delete and seeded from the file when a session opens; the file is read on open
only, never per decision.

**Paragraph-break silence stays out of Settings.** It is an STT-worker
constant, not a model budget.

## Not this piece

- Recall measurement, online and offline.
- Merging semantic retrieval into the prefilter.
- Issue #52 (markdown export, re-transcription, detail view) — design recorded
  in `TODO.md`.

## Known limits

`MODEL_STATE_CHARS = 1400` is arithmetic from the model row, not a tokenizer
measurement. Slider maxima above ~800 characters can be truncated by the row,
and the truncation keeps the head; both are recorded in `TODO.md`.
