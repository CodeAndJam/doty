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

## A ready-made dataset

`test-fixtures/ranker/transcripts.json` ships 50 pt-PT DM narration moments —
25 from *Call of the Netherdeep*, 25 from *Ryoko's Guide to the Yokai Realms* —
covering combat, exploration, social, horror, travel and downtime scenes.

`pnpm ranker:headless` runs the model over all of them and writes
`test-results/ranker-headless.md`: every example with the mood it read, its top
five picks and their probabilities, and what the policy would have done at a
boundary and mid-track. `rows.json` also gains a `model` block per row.

Use that report to decide what to label: the examples where the top pick is
clearly wrong are the ones worth grading first. Then label in this app and run
`pnpm ranker:eval` for the numbers.

## 2. Label them

Open `index.html`, choose `rows.json`, and for each moment click the track you
would actually have played. Click again to clear. Hit **open music folder** and
pick your music folder once — the page then lists and plays every track, so you
can label a track the model was never offered (a recall miss, recorded as
`offered: false`).

- `1`–`9` pick by position, `←`/`→` move between moments, `Backspace` clears
- `▶` plays a candidate, or any track in the folder
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

The report answers two different questions, and they must not be averaged:

**Ranking** — given the twenty it was offered, did it choose well? `top-1`,
`top-3`, and `precision @ ≥0.9` (how often a confident pick was right, i.e. the
chance an unasked change is wrong).

**Retrieval** — were the twenty the right ones? Every label picked from the
music folder that was *not* among the twenty is a recall miss, reported with the
track names and excluded from the ranking numbers. A recall miss is a prefilter
problem; no ranker tuning can fix it.

Plus **abstention**: rows you labelled "nothing here fits", with the mean top
probability there. That number being high is the dangerous case — the model
wanted to act on a scene where nothing suited.

The gate fails if top-1 or the offered share drops more than five points below
`baseline.json`.

Rows you leave unlabelled are ignored, so label in passes — the harness only
grades what exists. Labels whose track was not among the twenty are reported
separately: they are retrieval failures, not ranking failures, and no ranker
change can fix them.

The folder selection is not remembered across reloads (a browser will not hand a
page persistent access to disk), so re-open the folder after a refresh. Your
labels survive regardless.
