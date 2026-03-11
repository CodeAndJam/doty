# TODO

## Pending

- [ ] Add a LICENSE file (MIT or Apache-2.0)
- [ ] Remaining `pnpm audit` vuln: `esbuild <=0.24.2` via `vite` — waiting on vite to bump esbuild to >=0.25.0
- [ ] Add `"type": "module"` to `package.json` to silence Node ESM reparsing warning
- [ ] Investigate upgrading `chokidar` to v4 (drops `fsevents` issue entirely)

## Done

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
