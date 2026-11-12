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
| **Nemotron 3.5 Streaming** (default) | 8.5% | 22.4% | 24.5% | 33.3% | ~10× RT | ~0.4 s |
| Parakeet Ultra (accuracy option) | 4.2% | **16.3%** | **23.5%** | 38.1% | ~25× RT | ≤10 s chunks |
| Voxtral Mini 4B Realtime (experimental) | 3.9% | 15.3% | — | 38.1% | **0.6–1.4× RT** | ~2.4 s |
| Whisper large-v3-turbo (not shipped) | 4.2% | 15.3% | — | 33.3% | ~16× RT | not wired |

\* From the [Handy model catalog](https://github.com/cjpais/Handy) FLEURS
benchmarks, which we treat as the gold standard for model choice.

Voxtral has the best published Portuguese score, but on this hardware it is
slower than realtime on noisy audio and it **dropped the first sentence** of
the music-masked fixture. It stays selectable, but it is not the default and
not in the absolute gate.

### Choosing between the two Portuguese models

**Nemotron 3.5 Streaming is the default** because the transcript drives live
recommendations: ~0.4 s after a phrase starts, text exists.

**Parakeet Ultra is the accuracy option** (Settings → Speech Recognition):

- 25 European languages, 4.2% FLEURS pt vs 8.5% for Nemotron.
- On our own DM fixture it is 6–7 pp better (16.3% vs 22.4% WER).
- It has its own voice-activity head and is robust to background noise
  (FLEURS noise sets 5.82% vs 6.72% for TDT v3 upstream).
- It cannot drift to English on short spans the way `parakeet-tdt-0.6b-v3`
  auto-detect does.

The trade-off is latency: a batch model only has text once a chunk is cut
(≤10 s, or 1.5 s of silence). `ChunkBuffer` cuts in the quietest 100 ms window
of the last 2.5 s and keeps the remainder, which keeps boundary damage to the
occasional fricative instead of a blind mid-word cut.

If accuracy matters more than the typing effect (saved transcripts, session
reprocessing, noisy rooms), pick Ultra. The gate measures both, and the
absolute bar stays on the default so it cannot silently get worse.

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
- No multi-speaker or diarization gate — the transcript is intentionally a
  single stream today.
- No end-to-end latency gate for the renderer (interim text at 60 fps); the
  worker-side latency is gated, the paint path is not.

## GPU / thermal notes

The STT gate runs on Metal. Numbers are hardware dependent; the baseline is
accuracy-only (WER/CER are deterministic) and speed is gated with a floor, not
against the baseline.
