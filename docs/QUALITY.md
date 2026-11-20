# Quality gates

Every merge to `main` ships a DMG, so "it builds" is not enough. These are the
gates that decide whether a change is allowed onto `main`.

| Gate | What it protects | Where it runs | Command |
|---|---|---|---|
| Lint + typecheck | correctness of the TypeScript surface | every PR (Ubuntu) | `pnpm lint && npx tsc --noEmit` |
| Unit tests | logic regressions | every PR (Ubuntu) | `pnpm test` |
| Build | packaging breakage | every PR (Ubuntu) | `pnpm run build` |
| App launch + STT ready < 5 s | startup and model-load performance | `e2e/` (macOS) | `pnpm test:e2e` |
| **STT accuracy** | Portuguese transcription quality | nightly + on demand (macOS) | `pnpm stt:eval` |
| **Footprint** | memory, CPU and decision latency on the target Mac | on demand, target Mac | `pnpm footprint` |

> Coverage thresholds (95%) are configured in `vitest.config.ts` but are not
> enforced: the CI command passes `--coverage` after a `--`, which vitest
> ignores. `pnpm test:coverage` currently reports ~25% globally. Wiring this up
> is tracked in `TODO.md`.

The STT gate is the one that matters most for this product: music
recommendations, scene detection and saved transcripts are all downstream of
the transcript. A silent accuracy regression would look like "the app feels
dumber", not like a crash.

## STT accuracy gate

`electron/stt-quality.test.ts` runs the **same decision logic the app ships** —
`LiveWriter` for streaming models, `ChunkBuffer` + batch decode for offline
models — over Portuguese fixtures, and fails on:

1. **Absolute WER ceiling** for the shipped default model per fixture
   (clean 10%, long DM 25%, noisy room 32%). A model that cannot clear the bar
   cannot be the default.
2. **Regression vs. the committed baseline** (`test-fixtures/stt/baseline.json`,
   +3 percentage points absolute; +5 pp on the synthetic-noise fixture, where
   streaming decoders differ by a few points between Metal implementations).
   Applies to every gated model, so an alternative model cannot quietly get
   worse either.
3. **Stress fixtures** (`"stress": true` in the manifest) hold a loose ceiling
   for every gated model instead of a regression bar, because streaming results
   vary by ~5 pp across Metal implementations. `dragon-portuguese.wav` (speech
   buried under music) is one: 40% ceiling, and no model is near it yet.
4. **Speed**: at least 1× realtime on audio longer than 20 s. Text that arrives
   after the scene changed is useless.
5. **No hallucination on silence**: 5 s of digital silence must produce zero
   words.

Report: `test-results/stt-quality.md` (uploaded by CI).

The CI runner is an M1 virtual machine: it decodes ~3× slower than an M4 Pro
and lands a few points apart on the noise fixture. All numbers below are from
the M4 Pro developer run.

### Current numbers (Apple M4 Pro, Q8_0)

| Model | pt FLEURS WER\* | DM clean WER | DM + 12 dB noise | Music-masked | Speed | Latency |
|---|---:|---:|---:|---:|---:|---|
| **Parakeet Ultra** (default) | 4.2% | **16.3%** | **23.5%** | 38.1% | ~25× RT | ≤10 s chunks |
| Nemotron 3.5 Streaming (lowest latency) | 8.5% | 22.4% | 24.5% | 33.3% | ~10× RT | ~0.4 s |
| Voxtral Mini 4B Realtime (experimental) | 3.9% | 15.3% | — | 38.1% | **0.6–1.4× RT** | ~2.4 s |
| Whisper large-v3-turbo (not shipped) | 4.2% | 15.3% | — | 33.3% | ~16× RT | not wired |

\* From the [Handy model catalog](https://github.com/cjpais/Handy) FLEURS
benchmarks, which we treat as the gold standard for model choice.

Voxtral has the best published Portuguese score, but on this hardware it is
slower than realtime on noisy audio and it **dropped the first sentence** of
the music-masked fixture. It stays selectable, but it is not the default and
not in the absolute gate.

### Choosing between the two Portuguese models

**Parakeet Ultra is the default**: it is the most accurate model that clears
the absolute gate on every fixture (16.3% vs 22.4% WER on the DM fixture), and
its own voice-activity head keeps music and room noise out of the decoder.

- 25 European languages, 4.2% FLEURS pt vs 8.5% for Nemotron.
- On our own DM fixture it is 6–7 pp better (16.3% vs 22.4% WER).
- It has its own voice-activity head and is robust to background noise
  (FLEURS noise sets 5.82% vs 6.72% for TDT v3 upstream).
- It cannot drift to English on short spans the way `parakeet-tdt-0.6b-v3`
  auto-detect does.

**Nemotron 3.5 Streaming is the latency option** (Settings → Speech
Recognition): ~0.4 s after a phrase starts, text exists, which keeps live
recommendations typing along with the table.

The trade-off is latency: a batch model only has text once a chunk is cut
(≤10 s, or 1.5 s of silence). `ChunkBuffer` cuts in the quietest 100 ms window
of the last 2.5 s and keeps the remainder, which keeps boundary damage to the
occasional fricative instead of a blind mid-word cut.

If the typing effect matters more than accuracy, pick Nemotron. The gate
measures both, and the absolute bar stays on the default so it cannot silently
get worse.

## Adding fixtures

Record real material, convert with:

```bash
ffmpeg -i input.m4a -ar 16000 -ac 1 -sample_fmt s16 test-fixtures/stt/name.wav
```

Add an entry to `test-fixtures/stt/manifest.json` with the exact transcript,
the language tag, `maxWer`, and a description of the recording conditions.
Then accept the new numbers:

```bash
STT_UPDATE_BASELINE=1 pnpm stt:eval
```

Never update the baseline to make a red gate green. If a change genuinely
improves accuracy, the numbers move down; if it regresses, the model choice or
the audio pipeline is the problem.

### Missing coverage (known gaps)

- **No real conference-mic recording yet.** Noise robustness uses synthetic
  white noise at 12 dB SNR (`electron/stt-quality/augment.ts`). A far-field
  table recording (laptop mic, 6 speakers, music playing) would be strictly
  better; add it as `conference-pt.wav`.
- No multi-speaker or diarization gate. The mic lane is still a single stream;
  Discord participants are a separate lane with a label from Discord itself, so
  nothing measures the two overlapping in one utterance.
- Remote-lane accuracy is unmeasured: its audio is each participant's own Opus
  stream downsampled to 16 kHz, not a room recording, and the 10 s chunking the
  mic lane relies on does not apply — an utterance is decoded whole.
- No end-to-end latency gate for the renderer (interim text at 60 fps); the
  worker-side latency is gated, the paint path is not.

## Footprint gate

`pnpm footprint` launches the built app with an isolated profile, waits until
every model is resident (ASR, ranker, embedder text and audio passes), and
measures four stages: cold load, idle, decisions, semantic search. It writes
`test-results/footprint.{json,md}`.

- Memory is `phys_footprint` per process, summed over the app's tree — the
  number Activity Monitor shows. On Apple Silicon that already includes the
  models' Metal buffers.
- CPU is `app.getAppMetrics()` per process, so the worker threads count.
- GPU is machine-wide (`ioreg`); macOS has no per-process attribution without
  root, so read the delta against the pre-launch baseline.
- A 1-minute load average above half the cores marks the run noisy and skips the
  gate: a busy Mac fakes both a regression and an improvement.

Budgets live in `test-fixtures/footprint/baseline.json`, keyed by
`<cpu>|<GiB>|<cores>`, so a Mac is compared with the last quiet run on the same
hardware. Idle memory is the tight one (15% over budget): a second resident
model is what a regression looks like. Decision p50 and p95 get 40% and 75%;
CPU gets 6 points. A Mac with no entry is measured but not gated.

```bash
pnpm build
pnpm footprint            # measure and gate against this Mac's entry
pnpm footprint:baseline   # re-record; only on a quiet Mac
```

Run it on the target M1 — with OBS and a browser open when checking
co-tenancy — not on GitHub's macOS runners: the app alone holds ~8 GB with every
model resident, so a runner would swap and the numbers would be meaningless.
Never re-record a baseline on a loaded machine; that teaches the gate to accept
the slow numbers.

The first M4 Pro run measured ~7.6 GB idle, ~33% CPU and 4.4 s per decision.
The recommendation cadence is 2 s (`src/lib/recommendCadence.ts`), so latency
saturates before memory does: a decision that takes longer than the interval is
the first thing this gate is meant to catch. Treat the committed M4 Pro entry as
provisional until it is re-recorded on the M1.

## GPU / thermal notes

The STT gate runs on Metal. Numbers are hardware dependent; the baseline is
accuracy-only (WER/CER are deterministic) and speed is gated with a floor, not
against the baseline.
