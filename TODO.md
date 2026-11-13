# TODO

## Pending

- [x] STT: retry once on the CPU when the GPU fails to load, instead of ending
      the session. Ported from Handy's supervisor, which does the same.
- [x] STT: transcribe.cpp 0.4.2 (parakeet mel-padding fix, mmapped weights).
      The 10-day release hold is waived for it in `pnpm-workspace.yaml`.
- [ ] STT: spoken-language detection over the transcript text, the way Handy uses
      `whatlang`. Rust cannot be copied into an Electron app; the JS equivalents
      (`tinyld`, `franc`) do the same job on the text we already have, and would
      replace the script guard with a real decision — plus enable "auto, but only
      among my preferred languages".
- [ ] STT: a real VAD model (transcribe-cpp exposes a `vad` role — Silero
      scores frames, `minSpeechMs`/`minSilenceMs`) instead of the RMS gate. The
      RMS gate stops a quiet room being decoded, but it cannot stop Roman-script
      hallucination ("Yeah, it's trying to make things") under a `pt` hint, and
      neither can the script guard: both are Latin. A VAD segmenter also gives
      better chunk cuts than the current quietest-frame heuristic.
- [ ] STT quality: record a real conference-mic fixture (laptop mic, far field,
      6 speakers, music playing) and replace the synthetic 12 dB SNR noise gate.
      See `docs/QUALITY.md`.
- [ ] STT quality: use `transcribe-cpp` 0.4 `vocabulary` for campaign names
      (hotwords) and `context_prompt` for scene continuity.
- [ ] STT quality: Voxtral Mini 4B is 0.6–1.4× realtime on M-series and drops the
      first sentence on masked audio. Keep experimental until a faster GPU path
      or a smaller quant clears the gate.
- [ ] STT quality: two-tier decode (Nemotron live + Parakeet Ultra re-decode of
      finished sentences) to get both ~0.5 s text and 4% WER.
- [ ] CI: coverage thresholds in `vitest.config.ts` are not enforced
      (`pnpm test -- --coverage` passes the flag after `--`); `pnpm test:coverage`
      reports ~25% globally. Enable per-directory instead of globally.
- [ ] #22 HTTP remote control API + Stream Deck plugin (placeholder in Settings, needs implementation)
- [x] Ranker: export d1-omni to ONNX. `d1-omni-text.onnx` (1.53 GB fp32) passes
      the parity gate at 1.5e-06 against PyTorch; int8 failed it (2.2e-01 drift,
      argmax flips) and is not shipped. `electron/d1-omni.test.ts` replays the
      fixture: token rows byte-identical, probabilities within 1e-4 on CPU.
      CoreML drifts ~3e-3 because it runs fp16, which is fine for the 0.9 gate.
- [x] Ranker: swapped in behind `RankDeps` (one choice question over the 20
      candidates) and the generative stack deleted. Autopilot acts at 0.9, a 0.7
      highlight marks a suggestion without acting on it, and override is a mode
      that silences the ranker until an explicit resume.
- [x] Ranker: download-once plumbing. One 1.41 GB archive carries the graph, its
      manifest and the tokenizer; it is fetched in the background when a library
      exists, sha256-verified, unpacked once and skipped on every later launch.
- [x] Ranker eval harness: `pnpm ranker:rows` builds production-shaped rows, the
      labelling app lives at `tools/ranker-lab/index.html`, and `pnpm ranker:eval`
      grades top-1/top-3/precision@0.9 against a baseline.
- [x] Ranker: 50 examples labelled (26 decided) and graded. First truth:
      top-1 0/24, top-3 25%, prefilter offered 92% of the DM's picks.
- [ ] Ranker: the option text is the ceiling. Every description is
      "name — BPM, energy" plus a constant genre ("Music"), so the model judges
      filenames. Add real tags, instrumental/vocal and loudness before touching
      a threshold — the 0/24 comes from what it is shown, not how it is asked.
- [ ] Ranker: label the rows. Add real narration moments to
      `test-fixtures/ranker/transcripts.json`, run `pnpm ranker:rows`, label in the
      browser, save `labels.json`. `precision @ ≥0.9` is what sets RANK_SWITCH_FLOOR.
- [ ] Ranker: upload `d1-omni-text-v1.tar.gz` (written to `~/.doty/models` by
      `scripts/export-d1-omni.py --pack`) to a `models-v1` release, and confirm
      the sha256 in `electron/d1-model.ts` matches it. Until then the background
      fetch 404s and the app stays on keyword matching. The LFM licence note
      belongs on that download.
- [ ] Ranker: wire the session loop. `electron/session/{policy,scene,director,store}.ts`
      and the two-question `session:evaluate` are in place and tested, but nothing
      calls them yet: `Soundboard` still drives autopilot from the old threshold.
      Next change executes `plan.action` (`queue-next` at the boundary, `play-now`
      only on a confirmed categorical change), records every decision through
      `session:decision`, and shows `sessionReport().overrideRate` in the UI.
- [x] Embeddings: background indexer (`electron/session/indexer.ts`), cosine
      retrieval over `track_vectors`, and the keyword prefilter kept as the floor.
      Batched, resumable, and a no-op until the model is on disk.
- [x] Embeddings: moved to EmbeddingGemma **2** (`embeddinggemma-2-q4`, Apache 2.0).
      Verified: one fused ONNX graph, needs empty `[0,512]` media tensors for a
      text row, 768-dim output, and it runs on CPU because CoreML rejects
      zero-element inputs.
- [x] Retrieval is text-first (ADR 0003). The eval says top-1 0/24 with 92% of picks
      offered, so a better retriever cannot move the number; the description can.
- [ ] Ranker: enrich `describeTrack` — loudness and onset rate from essentia, an
      instrumental flag, and hand tags. The option text is currently a filename,
      BPM and `"Music"`. This is the measured bottleneck.
- [ ] Embeddings: **audio** path, triggered by a retrieval miss in the eval — `audio_encoder_q4.onnx` takes
      `input_features` shaped `[1, frames, 128]` plus `input_features_mask`;
      mel parameters must be read from the model config and validated on one real
      track before indexing — a wrong mel yields plausible vectors that mean
      nothing. `tagsFromAudio` and the vocabulary are written and tested; they
      need audio vectors to score.
- [x] Embeddings: retrieval verified on the real library. A calm scene returns
      dungeon/campfire ambience; a chase query returned caves before the indexed
      text included BPM/energy, which is what taught us the filename is not enough.
- [x] Embeddings: model retrieved into `~/.doty/models/embeddinggemma-300m/`
      (197 MB q4 + tokenizer). Verified against the real graph: pooled
      `sentence_embedding` output, 768 dims, and a calm transcript scores 0.241
      against Campfire versus 0.166 against The Enemy. Task prefixes are applied
      (query vs document), which the model card requires.
- [ ] Embeddings: hosting. The model is installed by hand today; a first-run
      download (or bundling, see README) has to ship with the app.
- [ ] App updates never re-download models: they live in `~/.doty/models`, outside
      the app bundle, so a new DMG reuses them. Do not move them into the bundle.
- [x] Preferences: read. Where the model's top two are within 0.02, the track the
      DM chose for this scene before breaks the tie. Probabilities are never
      rewritten — that would fake confidence the model did not have — and a
      decisive model is never overruled.
- [ ] Session report UI: overrides per session and time-to-first-manual-pick, the
      KPI from AGENTS.md.
      narration plus the 20 candidates and the track you would have picked — and
      record top-1 for d1-omni against the current cross-encoder. This set also
      sets `RANK_SWITCH_FLOOR`.
- [ ] Audio metadata: integrated loudness (LUFS) and onset rate per track, for the
      candidate prefilter. Deferred until the ranker eval shows combat and horror
      being confused; both need a versioned metadata cache and a background
      re-analysis pass (~1.5–3 h per 5000 tracks).
- [ ] Orphaned models: `Qwen3-0.6B-Q4_K_M.gguf` (~400 MB) and
      `nomic-embed-text-v2-moe.Q8_0.gguf` (~487 MB) stay in `~/.doty/models/`
      after the decision-model swap. Harmless; delete by exact filename later if
      anyone complains.

## Music Player — Implementation Order

1. [x] #24 — Architecture refactor: extract composable hooks from `useAudioPlayer` (foundation)
2. [x] #17 — Reliable seek bar with time display and buffering feedback
3. [x] #23 — Volume control with per-output levels
4. [x] #18 — Loop mode for single track and queue
5. [x] #25 — Custom user tags on tracks for search and recommendation
6. [x] #19 — Music queue with drag-to-reorder and queue loop
7. [x] #20 — Crossfade with configurable fade duration (replaces "Smooth transitions between musics")
8. [x] #21 — Discord bot integration for audio streaming
9. [ ] #22 — HTTP remote control API with Stream Deck plugin support

## Done

- [x] Architecture deepening on top of #111: one IPC channel registry with typed `handle`/`send`/`invoke`/`subscribe` plus a contract test, one model-download state machine for STT/LLM/embedding, `sfx-library` extracted, ranking moved into `rankTracks` with shared music/SFX scoring, orphaned `prefilter` deleted (`music://` was already deduplicated in #111)

- [x] STT quality gate: WER/CER + noise + silence + realtime checks over Portuguese fixtures, committed baseline, nightly macOS workflow (`pnpm stt:eval`, `docs/QUALITY.md`)
- [x] STT: live transcript no longer waits for session stop when a streaming model freezes `committed`; worker messages serialized
- [x] STT: 10s chunked live decode for batch models (Parakeet Ultra), quiet-window cuts so no word is split
- [x] STT: Parakeet Ultra added as the accuracy option (16.3% vs 22.4% WER on the DM fixture)
- [x] STT: audio captured while the model loads is replayed instead of dropped
- [x] `pnpm audit` clean (0 vulns): all deps on current major, 10-day release hold via `minimumReleaseAge`, transitive CVEs pinned via overrides
- [x] Perf: reranker inference moved off the Electron main thread into a `worker_threads` worker; warmup deferred to idle time
- [x] Perf: music library list cached instead of re-walking the folder on every recommendation (scanner invalidates on change)
- [x] Speech model downloads: HTTP Range resume, cancel button in Settings, partial files kept for resume (not deleted on quit)
- [x] Autopilot: recent-track avoidance covers manual plays too; PT keywords + accent-insensitive matching (`ação` matches `acao`) verified with tests
- [x] Recommendation model: confirmed multilingual `mmarco-mMiniLMv2-L12` is in use; removed the stale English-only ms-marco worker
- [x] #12 Autopilot: heuristic confidence estimation, Portuguese keyword profiles, DecisionLog — all present and tested
- [x] Onboarding: skip the speech-model install and download it in the background while the app stays usable; atomic model downloads (`.part` + rename)
- [x] Recommendation transparency: ranker type + confidence badge on Suggestions header, collapsible Decision Log panel for beta testing
- [x] Discord: asarUnpack config for @discordjs/opus, sodium-native, opusscript, prism-media
- [x] Upgrade chokidar v3 to v4 (drops fsevents dependency, uses native fs.watch)
- [x] Discord: 17 integration tests for connect/disconnect/stream lifecycle
- [x] Lower Node engine requirement from >=24 to >=20 (LTS)
- [x] ~~Add `"type": "module"` to `package.json`~~ — incompatible with electron-vite (changes preload output to .mjs, breaks app)
- [x] Show directory in SFX tooltip (matching TrackCard behavior)
- [x] Resolve all Biome lint warnings: useButtonType, useIterableCallbackReturn, useExhaustiveDependencies, useKeyWithClickEvents
- [x] Pre-commit hook: Husky + lint-staged for Biome lint + tsc typecheck on every commit
- [x] Fix Biome formatting errors across codebase (4 files)
- [x] Fix DM input debounce: useCallback for runRecommendation/runDmRecommendation
- [x] Fix SFX recommendations: label-based mood matching, category-diverse fallback defaults
- [x] Fix SFX volume slider: reactive sfxVolumes state, per-SFX persistence, master vol multiplier
- [x] Shared VolumePopover component (PlayerBar + SfxCard) via portal rendering
- [x] E2E tests for DM input pipeline (3 tests)
- [x] #11 SFX: SFX scanner populates `sfx:list` from sfxFolder
- [x] #11 SFX: heuristic SFX recommendation engine (keyword + category + tag scoring)
- [x] Play history tracking + history-boosted recommendations (SQLite play_history table, default recs on empty prompt)
- [x] Tooltip z-index fix: flip-below positioning when near column headers (TrackCard + SfxCard)
- [x] Unified DM Soundboard: two-column layout (Music + SFX side by side), DM prompt at top, Browse SFX overlay
- [x] STT quality round 2: VAD tuning, flush on silence, GTCRN denoiser, CT-Transformer punctuation
- [x] Improve STT quality: Silero VAD, modelType, blankPenalty, hotwords support
- [x] Replace `electron-rebuild` with `@electron/rebuild@4.0.3`
- [x] Update `electron-vite` to v5
- [x] Remove dead Python sidecar files
- [x] Remove dead `electron/recorder.ts` stub
- [x] Fix appId typo (`codeandiam` -> `codeandjam`)
- [x] Add `.env*` and `.DS_Store` to `.gitignore`
- [x] Set up release-please + chained DMG build workflow
- [x] Dual-arch DMG builds (ARM + Intel)
- [x] Reranker model scoring fix (raw logits, q4 dtype)
- [x] Codebase refactor (Icons, PlayerBar, TrackCard, BrowsePanel, useAudioPlayer)
- [x] Settings improvements, DM input priority, transcript toggle
- [x] Configurable recommendation count (1-20)
- [x] All 30 tests passing
