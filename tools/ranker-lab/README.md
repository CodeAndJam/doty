# Ranker lab

A single page for labelling what the ranker should have picked. No build step, no
server: open `index.html` in a browser.

```
tools/ranker-lab/index.html      ← open this
tools/ranker-lab/README.md       ← you are here
test-fixtures/ranker/
  transcripts.json               ← you write: the moments worth grading
  rows.json                      ← pnpm ranker:rows
  labels.json                    ← export from the page, save here
  baseline.json                  ← RANKER_UPDATE_BASELINE=1 pnpm ranker:eval
```

## 1. Collect the moments

Put real narration in `test-fixtures/ranker/transcripts.json`, one entry per
moment you care about:

```json
[{ "id": "calm-cell", "text": "…the last 800 characters the table said…" }]
```

Then build the rows. This runs the shipped prefilter, so each row holds exactly
the twenty candidates the app would have offered:

```bash
pnpm ranker:rows
```

## 2. Label them

Open `index.html`, choose `rows.json`, and for each moment click the track you
would actually have played. Click again to clear.

- `1`–`9` pick by position, `←`/`→` move between moments, `Backspace` clears
- `shift`-click a track you would *never* play at this moment
- `0` marks "nothing here fits" — the most useful label of all, because that is
  the case autopilot must not act on

Labels live in the browser's local storage as you go, so a refresh loses
nothing. **Export labels** downloads `labels.json`; save it to
`test-fixtures/ranker/labels.json`.

## 3. Grade

```bash
pnpm ranker:eval                          # prints and writes test-results/ranker-quality.md
RANKER_UPDATE_BASELINE=1 pnpm ranker:eval  # accept today's numbers as the baseline
```

The gate fails if top-1 drops more than five points below `baseline.json`.
`precision @ ≥0.9` is the number that governs autopilot: it is how often a
confident pick was actually right, and therefore the chance an unasked change
is wrong.

Rows you leave unlabelled are ignored, so label in passes — the harness only
grades what exists.
