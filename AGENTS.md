# Project Agents and Tools

## Offline Transcription Assistant (`transcribe.py`)

A standalone script for high-accuracy, low-latency Portuguese transcription using the **NVIDIA Parakeet TDT 0.6B v3** model.

### Key Features
- **Direct NeMo Integration**: Uses the `nemo_toolkit` specifically for the TDT (Token-and-Duration Transducer) architecture, known for superior speed and robustness.
- **Purely Offline**: No dependence on external APIs or Pipecat transports for core transcription.
- **Portuguese Optimized**: Specifically configured for Portuguese language recognition.
- **Auto-Device Selection**: Automatically utilizes Apple Silicon (MPS) or NVIDIA (CUDA) if available.

### Setup & Running
1. **Dependencies**:
   ```bash
   uv sync
   ```
2. **First Run**: The script will automatically download the 2.5GB model from Hugging Face on its first execution.
3. **Execution**:
   ```bash
   uv run transcribe.py
   ```
4. **Output**: Live transcription is printed to the console and saved with timestamps to `portuguese_transcription.txt`.

---

## Game Master Music Assistant (Experimental)

A comprehensive system for RPG sessions involving a mobile app and a central AI server.

### Features
- **Mobile Client**: React Native app for the GM to control the session and see live text.
- **AI Music Proposals**: Automatic background music suggestions based on live transcription session context (using Ollama or Perplexity).
- **Audio Mixing**: Real-time mixing of local thematic music files into the voice stream.
- **Pipecat Backed**: Uses the Pipecat framework for real-time WebRTC communication and AI orchestration.

### Setup
- **Server**: `uv run server/bot.py`
- **App**: `cd app && npm run ios` (or android)

### Core Technologies
- `nemo-toolkit` (for offline transcription)
- `pipecat-ai` (for the GM Assistant bot)
- `react-native` (for the GM app)
- `ollama` / `perplexity` (for LLM reasoning)
