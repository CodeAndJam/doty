# doty - GM Music Assistant with Parakeet-MLX

A comprehensive system for RPG sessions with an AI music assistant and real-time speech recognition.

## Quick Start

### Speech-to-Text (STT) with Parakeet-MLX

Run the STT script using `uv`:

```bash
uv run --python 3.10 stt_parakeet.py
```

The script will:
1. Load the Parakeet-MLX model (~2.5GB on first run)
2. Record 5 seconds of audio from your microphone
3. Transcribe the audio (Portuguese and English supported)

**Requirements:**
- `portaudio`: `brew install portaudio`
- Python 3.10 (pre-configured in uv)

### Features

- **Offline Transcription**: No API calls, completely local
- **Portuguese Optimized**: Uses MLX-compatible Parakeet-TDT model
- **Apple Silicon Native**: Optimized for M1/M2/M3 Macs
- **Minimal Dependencies**: Pure `uv`-based setup

## Technologies

- **Parakeet-MLX**: Speech recognition using MLX framework
- **MLX**: Apple Silicon optimized ML framework
- **PyAudio**: Microphone input
- **uv**: Fast Python package manager

## Project Structure

```
stt_parakeet.py      # Main STT script
transcribe.py        # Alternative using NeMo (WIP)
pyproject.toml       # Dependencies & config
server/              # Pipecat backend (experimental)
app/                 # React Native GM app (experimental)
```

## Troubleshooting

If you encounter library loading errors:
- Use Python 3.10 (which has compatible pre-built wheels)
- Clear cache: `rm -rf ~/.cache/uv`
- Reinstall: `uv sync --python 3.10`

## Next Steps

- [ ] Implement real-time streaming transcription
- [ ] Add music mixing based on transcription context
- [ ] Create web dashboard for GMs
- [ ] Integrate with D&D campaign managers
An assistant to the DM 
