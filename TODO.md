# TODO

## Pending

- [ ] Discord capture: the feature is in place — `all` mode subscribes to every
      participant, labels segments with a `Speaker`, writes `<v>` voice spans and
      a `-remote.wav`, refuses to switch on with no model, settles a dead decode
      worker, and caps an utterance at 30 s. Still open: measure the shipped
      batch-per-utterance decode against per-speaker streaming with
      `pnpm spike:discord` on a 3+ person call, and add a remote-lane fixture to
      `QUALITY.md`.

- [x] STT: retry once on the CPU when the GPU fails to load, instead of ending
      the session. Ported from Handy's supervisor, which does the same.
- [x] STT: transcribe.cpp 0.4.2 (parakeet mel-padding fix, mmapped weights).
      The 10-day release hold is waived for it in `pnpm-workspace.yaml`.
- [ ] STT: spoken-language detection. transcribe-cpp's `langid` role was measured
      on real VAD segments: it labels 5 of 25 Portuguese segments as sq/bg/ca/gl,
      and a 0.75-confidence veto would delete a third of the narration. The ASR
      also ignores the hint (parakeet-ultra: identical text and WER with and
      without `language`). `preferredCodes`/`rejectsLanguage`/`hintFromLangId`
      ship as tested policy only; do not wire a veto until the model improves.
      Re-open with a real room recording.
- [x] STT: the invented words came from decoding each VAD phrase **alone**. A
      real session produced "Resurrê? O presužma", "Gareth", "Punks" and
      "Stale tętrz" while the same audio decoded as one 15 s window was clean.
      Batch models now accumulate gated speech in `ChunkBuffer`, wait 3 s of
      pause before decoding, and a VAD segment closes at 800 ms instead of 300.
      On that session the invented words and fragments are gone.
- [x] STT: a short Portuguese segment with Latin Extended letters (`ž`, `ę`) is
      dropped as invented; a foreign name inside a full sentence still passes.
- [ ] STT: remaining word-level slips on mumbles ("mas para a cidade" for "vamos
      para a cidade"). Two-tier re-decode of finalized sentences with a larger
      context is the next lever.
- [x] Architecture: the library is one module (`electron/library.ts`); membership,
      one description per item, and vectors no longer get reassembled by each
      caller. The SFX folder is indexed too, under a prefixed key.
- [x] Architecture: the lane is a label (`src/lib/lane.ts` + `lane_overrides`),
      not the folder a file sits in. `setLane` writes a row; `moveTrack` stays
      the separate disk action.
- [x] Architecture: one indexing run with two reported phases, paused while the
      microphone is recording, instead of two booleans and a borrowed event.
- [x] Architecture: the session pass lives in `electron/session/pass.ts` with
      injected dependencies, so the hold throttle and serialisation are tested.
- [x] Architecture: `override` and the autopilot master switch are deleted; a
      profile that had `autopilotEnabled: false` is migrated to both channels
      off. The per-channel switches are the only gates.
- [ ] Wire the UI to the new backend: lane badge per row, index chip with the two
      phases, semantic search in both browse panels (`library:search` returns
      `{ mode, items }`), and the session-name prompt. The channels and the lane
      label in `getAllMetadata` / `getSfxList` exist; nothing draws them yet.
- [x] STT: VAD gating. `silero-vad-v6.2-F32.gguf` (1.2 MB) is loaded when present
      and gates live audio by speech probability; the RMS gate remains the
      fallback. Measured: 0.00 s emitted for a loud music bed, pink noise and
      silence; 42.4 s of 47.8 s speech kept; music now transcribes to "". Side
      models download with the ASR model. Room fixtures (vocal music crossing the
      gate, overlapping speakers) still need a real recording — see
      `test-results/stt-room.md` (gitignored) or `electron/stt/room.test.ts`.
- [ ] Profiles: instances share `~/.doty/models`, so two profiles downloading the
      same model at once write the same `.part` file. Serialize on a lock file or
      give the `.part` a per-process suffix before this bites a first run.

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
- [x] Ranker: the option text was the ceiling. `describeTrack` now names the
      library's own folder taxonomy and translates tempo/mode/duration/energy
      into words. The energy metric was also broken: `sqrt(mean(x^2)) * 10`
      clamped 30 of 43 real tracks to exactly 1.0. It is now RMS dBFS mapped
      from -40..0, giving 27 distinct values on the same library. Top-1 went
      from 0/24 to 7/22; the harness also sends the duration and genre it was
      silently omitting. See `docs/END-GOAL.md`.
- [ ] Ranker: label the rows. Add real narration moments to
      `test-fixtures/ranker/transcripts.json`, run `pnpm ranker:rows`, label in the
      browser, save `labels.json`. `precision @ ≥0.9` is what sets RANK_SWITCH_FLOOR.
- [x] Ranker: `models-v1` is published with `d1-omni-text-v1.tar.gz`, and the app's
      download button installs it (verified end to end on a throwaway profile:
      1.4 GB fetched, graph sha256 matches the manifest, licence extracted). The
      archive now carries the LFM licence, which changes its hash — repack with
      `scripts/export-d1-omni.py --pack` and update `RANKER_SHA256` whenever the
      export changes.
- [x] Ranker: the session loop is wired. The player repeats the current cue by
      default (`loopMode` single), so a boundary is a genuine choice rather than a
      deadline. Autopilot changes cue at 0.40 with a 1.5x margin, or 0.30 on a
      categorical scene change, and holds otherwise. The legacy threshold-driven
      autopilot is no longer fed music while the director runs.
- [x] Learning: skips are stored as rejections, not preferences. Two skips of the
      same track in the same scene demote it even when the model is confident;
      tie-breaks use the DM's choices. Previously a skip recorded a *preference*
      for the track that replaced it, teaching the opposite of the signal.
- [ ] Ranking recall: 84.6% of the DM's picks are among the twenty offered (was
      92% before the energy fix). Candidate sets are keyword-first; semantic
      retrieval is indexed but not merged into the prefilter. This is the next
      lever — a track that is not offered cannot be chosen.
- [ ] Ranking: acceptable-set labels. The harness accepts them but every existing
      label is a single pick, which is why top-1 31.8% understates a model whose
      alternatives are often defensible. Label a few rows with more than one
      acceptable track.
- [x] Embeddings: background indexer (`electron/session/indexer.ts`), cosine
      retrieval over `track_vectors`, and the keyword prefilter kept as the floor.
      Batched, resumable, and a no-op until the model is on disk.
- [x] Embeddings: moved to EmbeddingGemma **2** (`embeddinggemma-2-q4`, Apache 2.0).
      Verified: one fused ONNX graph, needs empty `[0,512]` media tensors for a
      text row, 768-dim output, and it runs on CPU because CoreML rejects
      zero-element inputs.
- [x] Retrieval is text-first (ADR 0003). The eval says top-1 0/24 with 92% of picks
      offered, so a better retriever cannot move the number; the description can.
- [x] SFX mixed into the music folder: the audio embedding separates cues from
      effects, soundscapes and game ambience. Duration/genre/path only fill in
      until the audio pass reaches a file; a middling clip is no longer guessed.
      Effects are dropped from music candidates so they stop costing slots.
- [x] SFX routing: every card carries `→ fx` / `→ music`. Main moves the file
      between the two configured folders, numbers collisions instead of
      overwriting, and rewrites the path in `tracks` and `track_tags`. It is a
      click, never automatic: the embedding decides the lane once it has a vector.
- [x] Overrides recorded from every manual change — and skips are stored as
      *rejections*, not preferences. Before, skipping wrote a preference for the
      replacement track, which taught the opposite of the signal.
- [ ] Ranker: the remaining `describeTrack` facts are onset rate (essentia has
      `OnsetRate`), an instrumental/vocal flag, and hand tags. The first two need
      a re-analysis pass and a measured gain; hand tags need the DM.
- [x] Embeddings: **audio** path. The mel contract came from the export's
      `preprocessor_config.json` (128 bins, 512-point FFT, 320/160 window/hop,
      semicausal padding) and matches the `Gemma4AudioFeatureExtractor` output;
      one clip is two passes (audio encoder → `audio_features` → fused graph).
      `decideKind` consumes the vectors, `test-results/audio-sfx.md` has the
      numbers. The embedding is the primary verdict now; duration/genre/path are
      only the fallback before a file is embedded. The eval is the measurement:
      `AUDIO_KIND_EVAL=1` rewrites `test-results/audio-sfx.md` with the per-track
      verdicts against the library's own genre labels.
- [x] Embeddings: audio path wiring. `startBackgroundPasses` runs the audio pass
      after the text index, on startup and on every folder change; `getAllMetadata`
      merges the verdict; `trackKindOf` feeds it to candidate filtering and the
      move button. Measured in the app: 43 vectors, 14 effects, no decode
      failures. The renderer refreshes when the pass completes.
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

- [x] Recommendation: the prompt was ignored once a library existed. Rows stamped with a lane but not yet analysed scored `NaN` (bpm/energy were `undefined`), and the `NaN` comparator kept the folder order: `horror` offered Campfire first. Missing numbers now score 0, and a prompt word the track's name carries is worth more than a perfect analysis fit (#141, `e2e/dm-input.spec.ts`).
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
