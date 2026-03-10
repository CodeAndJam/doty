# Doty

AI-powered music recommender for tabletop RPG sessions. Listens to your table via continuous speech-to-text, then uses a local LLM to pick the best matching tracks from your music library in real time.

## How it works

1. **STT** — Parakeet TDT v3 (sherpa-onnx, runs fully offline) transcribes your microphone in 5-second chunks.
2. **Recommendations** — Qwen3-0.6B ONNX analyses the rolling transcript and picks 5 tracks from your library that match the mood.
3. **Soundboard** — Recommended tracks appear as playable cards. Click to preview.
4. **DM prompt** — Type a scene description ("dark dungeon", "campfire") to trigger a manual recommendation.

Everything runs locally. No API keys, no internet required after first model download.

## Requirements

- macOS (arm64 or x64)
- Node.js 20+

## Local development

```bash
# Install deps and rebuild native addons against Electron
npm install

# Run in dev mode (hot reload)
npm run dev

# Run unit tests
npm test

# Run e2e tests (requires a prior build)
npm run build && npm run test:e2e
```

## First launch

On first launch the app will prompt you to download the **Parakeet TDT v3** ASR model (~640 MB). It is saved to `~/.doty/models/` and only downloaded once.

The **Qwen3-0.6B** recommendation model (~400 MB) is downloaded automatically on the first recommendation request and cached to `~/.doty/hf-cache/`.

## Settings

- **Music folder** — point Doty at your local music library (mp3, flac, wav, m4a, ogg, aac).
- **Transcript folder** — optional folder where session transcripts are saved automatically.
- **Microphone** — select the input device used for transcription.

## Architecture

| Component | Technology |
|---|---|
| UI | React + Tailwind CSS (Electron renderer) |
| STT | sherpa-onnx-node (Parakeet TDT v3 int8) |
| Recommendations | @huggingface/transformers (Qwen3-0.6B ONNX q4) |
| Audio analysis | essentia.js + ffmpeg-static |
| LLM process isolation | Electron `utilityProcess` (separate heap from ASR) |

## Building a DMG

```bash
npm run dist
```

Produces a universal macOS DMG in `dist/`.

## Release process

Releases are fully automated via `release-please`. Every merge to `main` bumps the version, updates `CHANGELOG.md`, and triggers a DMG build. See `AGENTS.md` for the full branching and commit convention.
