# Changelog

## [1.7.0](https://github.com/CodeAndJam/doty/compare/v1.6.1...v1.7.0) (2026-03-15)


### Features

* **discord:** asarUnpack for native modules, chokidar v4 upgrade, and integration tests ([2dca2ab](https://github.com/CodeAndJam/doty/commit/2dca2ab41f99ad9449691b22f967d211ec4fbd82))


### Bug Fixes

* **lint:** resolve all Biome warnings — useButtonType, useIterableCallbackReturn, useExhaustiveDependencies, useKeyWithClickEvents ([c733ff5](https://github.com/CodeAndJam/doty/commit/c733ff5c554fc8904529ba37c32b68041125253e))
* revert "type": "module" — breaks electron-vite preload output (.mjs vs .js) ([e1b73d5](https://github.com/CodeAndJam/doty/commit/e1b73d59b2211f77b59015f80ca2a0b3a29a14d5))

## [1.6.1](https://github.com/CodeAndJam/doty/compare/v1.6.0...v1.6.1) (2026-03-15)


### Bug Fixes

* **soundboard:** fix DM input debounce, SFX recommendations, volume controls, and play history ([#39](https://github.com/CodeAndJam/doty/issues/39)) ([4cae7a9](https://github.com/CodeAndJam/doty/commit/4cae7a9235439b1e162204391715f8f2db806481))

## [1.6.0](https://github.com/CodeAndJam/doty/compare/v1.5.0...v1.6.0) (2026-03-14)


### Features

* **discord:** SFX streaming, auto-connect, and Biome code quality ([#35](https://github.com/CodeAndJam/doty/issues/35)) ([b39165d](https://github.com/CodeAndJam/doty/commit/b39165dc7b07def8e78df6d2d89432855a07c367))

## [1.5.0](https://github.com/CodeAndJam/doty/compare/v1.4.0...v1.5.0) (2026-03-13)


### Features

* **sfx:** add recommendations, pinning, tags, and metadata tooltip for SFX ([#34](https://github.com/CodeAndJam/doty/issues/34)) ([c3780c9](https://github.com/CodeAndJam/doty/commit/c3780c963573ba4bf1632992f22e4e14a702554b))


### Bug Fixes

* **discord:** sync pause, resume, and seek with Discord voice stream ([#32](https://github.com/CodeAndJam/doty/issues/32)) ([0906672](https://github.com/CodeAndJam/doty/commit/0906672b9d86715fec54c3009521f20e4c214188))

## [1.4.0](https://github.com/CodeAndJam/doty/compare/v1.3.1...v1.4.0) (2026-03-13)


### Features

* **discord:** add Discord bot integration for audio streaming ([#29](https://github.com/CodeAndJam/doty/issues/29)) ([0215eef](https://github.com/CodeAndJam/doty/commit/0215eef31e68a679d2148ac34bcb5261f76df58d))

## [1.3.1](https://github.com/CodeAndJam/doty/compare/v1.3.0...v1.3.1) (2026-03-13)


### Bug Fixes

* **player:** prevent crash on rapid seeking and add E2E seek test ([c93d11b](https://github.com/CodeAndJam/doty/commit/c93d11ba195db0855a11adcb675f616c2f9ec664)), closes [#26](https://github.com/CodeAndJam/doty/issues/26)
* **player:** seek bar jumps to 0 due to missing Range request support ([ee91287](https://github.com/CodeAndJam/doty/commit/ee912879a0840d6a2e46f42cd4c4af783dad1a63)), closes [#26](https://github.com/CodeAndJam/doty/issues/26)
* **player:** seek bar jumps to 0 due to missing Range request support ([6a8d381](https://github.com/CodeAndJam/doty/commit/6a8d381564b1fc44c8b77909d7252b02bd8b2652)), closes [#26](https://github.com/CodeAndJam/doty/issues/26)

## [1.3.0](https://github.com/CodeAndJam/doty/compare/v1.2.0...v1.3.0) (2026-03-13)


### Features

* music player with queue, tags, crossfade, and track info tooltip ([6240b7c](https://github.com/CodeAndJam/doty/commit/6240b7c57253da2bed3f55142a1189ac74fe0ba4))


### Bug Fixes

* codebase review fixes and TrackCard tests ([4b9d51e](https://github.com/CodeAndJam/doty/commit/4b9d51e953a12fde147102d992e61d3e3878d3cd))
* **ui:** show track metadata tooltip on hover instead of click ([b3871f1](https://github.com/CodeAndJam/doty/commit/b3871f1636a98b403a52674fbdc961dfd9c997d5))

## [1.2.0](https://github.com/CodeAndJam/doty/compare/v1.1.0...v1.2.0) (2026-03-11)


### Features

* **asr:** improve STT quality with denoiser, punctuation, and VAD tuning ([#15](https://github.com/CodeAndJam/doty/issues/15)) ([0284f4c](https://github.com/CodeAndJam/doty/commit/0284f4cd383d2c2af57d32d5254080ad17035930))
* **asr:** improve STT quality with Silero VAD, hotwords, and tuned config ([#13](https://github.com/CodeAndJam/doty/issues/13)) ([dd9201c](https://github.com/CodeAndJam/doty/commit/dd9201ccb4d813e90f9d4d981cc699c9a0f9c340))

## 1.0.0 (2026-03-11)


### Features

* Add .gitignore to exclude transcriptions directory from version control ([afd7b1f](https://github.com/CodeAndJam/doty/commit/afd7b1f27c0095ed5a75403dd882cd130d6ba4eb))
* Add real-time Portuguese speech-to-text transcription using Pipecat and WhisperSTT, with output to file and console. ([3300294](https://github.com/CodeAndJam/doty/commit/33002946b9fea3f80c77f26e83a872c250c6d931))
* **analyzer:** add essentia.js audio analysis with BPM, key, danceability and energy ([5ca7fbf](https://github.com/CodeAndJam/doty/commit/5ca7fbf081a84d1a538d46a7296fdfaa6c96ed37))
* **backend:** add configurable recommendation count, chokidar fix, and metadata improvements ([c73d0b2](https://github.com/CodeAndJam/doty/commit/c73d0b25af4ec5a603eff91bbd26b8a70f85111b))
* Implement continuous speech-to-text functionality with session-based file management and timestamped transcriptions ([664c203](https://github.com/CodeAndJam/doty/commit/664c203ecd25c275b857311f92de0ddeb84b2707))
* **recommendations:** heuristic keyword+audio-feature ranker as LLM fallback ([6873ec2](https://github.com/CodeAndJam/doty/commit/6873ec2aff32f9dcea41f7228399952af9601ba1))
* **recommendations:** renderer Web Worker inference with transformers.js v4 WASM ([5760437](https://github.com/CodeAndJam/doty/commit/5760437bb960d2b9ec32b48f62f662d250b2dce3))
* revamp as Electron app with Parakeet STT and AI music soundboard ([bc10dce](https://github.com/CodeAndJam/doty/commit/bc10dce4ee2b0c87c0401c76655c53cbf5df9cca))
* **soundboard:** add Browse All panel to search and pin tracks before a session ([7c19d28](https://github.com/CodeAndJam/doty/commit/7c19d28cd779d1ef5f5481cbf4d4be5b6172d8fd))
* **soundboard:** add speaker selector, improve seek bar, and keyboard shortcuts ([9b23ab9](https://github.com/CodeAndJam/doty/commit/9b23ab947358ff30d698c3e3fb9966214a62e3cf))
* **soundboard:** revamped UX with persistent player, pinned tracks, and stable suggestions ([238a5ad](https://github.com/CodeAndJam/doty/commit/238a5ad7c4e2c40582ec9536261b1be28af8ca44))
* **transcripts:** recursive music scan and transcript folder setting ([f33c5ba](https://github.com/CodeAndJam/doty/commit/f33c5bae959bac86fff91c6bccbbc58b1f208379))
* **ui:** add Cmd+, keyboard shortcut to open Settings ([ccd5797](https://github.com/CodeAndJam/doty/commit/ccd57975cea9e2d5faadf1081e6e991ac390f9b0))
* **ui:** add settings improvements, DM input, transcript toggle, and reranker download overlay ([4dbdfab](https://github.com/CodeAndJam/doty/commit/4dbdfab2f38b8c02ef088be351090873e8c20e55))
* **ui:** allow Attune while model loads, use heuristic ranker as instant fallback ([f1dbd9f](https://github.com/CodeAndJam/doty/commit/f1dbd9fcf323a88cb283aa2b5ad1d571a92fecd2))


### Bug Fixes

* **analyzer:** pass EssentiaWASM module directly instead of calling as factory ([d706034](https://github.com/CodeAndJam/doty/commit/d7060344fb842dab3fd4e7484b3ed53f43779419))
* **analyzer:** run essentia in worker_threads to unblock main process, fix audio playback noise ([d582789](https://github.com/CodeAndJam/doty/commit/d582789501fcc5b9159c0741b03ebdd985e601bb))
* **asr:** switch reranker to AutoTokenizer + raw logits with dtype q4 ([d7dbe18](https://github.com/CodeAndJam/doty/commit/d7dbe1876c6e49e2751a9f2688ec7746b10d92e1))
* **audio:** fix music:// URL parsing for standard privileged scheme ([c4902e4](https://github.com/CodeAndJam/doty/commit/c4902e41c1735b1c3f5960b86a4f2ead18fee52b))
* **audio:** register music:// as privileged scheme so audio plays from app:// context ([ff894dc](https://github.com/CodeAndJam/doty/commit/ff894dcef87385060f21e39723315f14bd93dccb))
* **audio:** remove standard:true from music:// scheme to fix protocol handler ([6452b05](https://github.com/CodeAndJam/doty/commit/6452b05ac6e099fe3ebf797e1fa38b9bc484f126))
* **build:** remove type:module, fix preload path, add pack script for CI ([4a6158a](https://github.com/CodeAndJam/doty/commit/4a6158acb63bbd53a97c7287214eacfe672c70f4))
* **main:** correct production renderer path to out/renderer/index.html ([2389181](https://github.com/CodeAndJam/doty/commit/23891810decf96a4859c41a7a7009fc03a41a1c1))
* **main:** reference preload index.mjs instead of index.js ([b9b6d4e](https://github.com/CodeAndJam/doty/commit/b9b6d4e7aa22958f5c2058d1b2f27ca7816c6178))
* **recommendations:** move all inference to renderer Web Worker, remove main process qwen ([2f1e3d5](https://github.com/CodeAndJam/doty/commit/2f1e3d59ab5921eebdde91dd722a35256d9594f5))
* **recommendations:** refresh on every chunk with pending re-run pattern ([055ca44](https://github.com/CodeAndJam/doty/commit/055ca44a64406f6b3fe0a5c1c6d4319ef86ae8a4))
* **recorder:** disable AudioContext output sink to suppress mixer errors ([dae7b5b](https://github.com/CodeAndJam/doty/commit/dae7b5bc01a460d7bb62c8072f646b515f664fc0))
* **recorder:** use relative path for worklet module in production ([726bc9c](https://github.com/CodeAndJam/doty/commit/726bc9c900385ded88d613ad35da9f1184119681))
* **soundboard:** fix Browse panel close button and add Escape key support ([3884c76](https://github.com/CodeAndJam/doty/commit/3884c76a95434e2630e877d561c74372f7760447))
* **ts:** add composite flag and remove unused param in Settings ([86af2c5](https://github.com/CodeAndJam/doty/commit/86af2c569f90d2f107aceb235e48cae46dac4897))
