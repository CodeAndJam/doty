# TODO

## Pending

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
