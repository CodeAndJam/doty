# TODO

## Pending

- [ ] Remaining `pnpm audit` vuln: `esbuild <=0.24.2` via `vite` — waiting on vite to bump esbuild to >=0.25.0
- [ ] Investigate upgrading `chokidar` to v4 (drops `fsevents` issue entirely)
- [ ] Discord: add `asarUnpack` config for native modules (packaging)
- [ ] Discord: integration tests for connect/disconnect/stream lifecycle
- [ ] #12 Autopilot mode (placeholder in Settings, needs implementation)
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

- [x] Add `"type": "module"` to `package.json` to silence Node ESM reparsing warning
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
