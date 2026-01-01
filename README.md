# doty - Continuous Speech-to-Text Recorder

Local speech recognition using Parakeet-MLX with audio merging and clean transcription.

## Usage

```bash
uv run --python 3.10 stt_parakeet.py
```

The script will:

1. Record 5-second audio segments from your microphone
2. Transcribe each segment in real-time
3. Save timestamps and audio files
4. On exit (Ctrl+C), ask if you want to:
   - **Merge** all audio into a single file
   - **Generate clean transcript** from the merged audio

## Requirements

- `portaudio`: `brew install portaudio`
- Python 3.10 (managed by `uv`)

## Features

- Offline local transcription (no API)
- Portuguese & English support
- Continuous recording with session management
- Audio merging and batch transcription
- Simple, minimal dependencies

## Output Files

- `transcriptions/session_YYYYMMDD_HHMMSS.txt` - Timestamped transcripts
- `transcriptions/session_YYYYMMDD_HHMMSS_clean.txt` - Clean merged transcript
- `recordings/session_YYYYMMDD_HHMMSS_segment_*.wav` - Individual segments
- `recordings/session_YYYYMMDD_HHMMSS_merged.wav` - Merged audio file
