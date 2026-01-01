# STT Setup - Using uv Exclusively

## One-Command Setup

```bash
# Install system dependencies
brew install portaudio

# Run the STT script (uv handles Python 3.10 + all packages)
uv run --python 3.10 stt_parakeet.py
```

That's it! No conda, no manual venv - just `uv`.

## What It Does

1. **First run**: Downloads Parakeet-MLX model (~2.5GB) and dependencies
2. **Every run**: Records 5 seconds from your mic and transcribes
3. **Output**: Prints transcribed text (Portuguese/English)

## Requirements

- **System**: macOS (Apple Silicon or Intel)
- **Brew**: `brew install portaudio`
- **Python**: Handled automatically by uv

## Example Output

```
[INFO] ==================================================
[INFO] Parakeet-MLX Local STT
[INFO] ==================================================
[INFO] Loading model...
[INFO] ✓ Ready
[INFO] 🎤 Recording 5s...
[INFO] Transcribing...
[INFO] 📝 Olá, como você está?
```

## Why Python 3.10?

- **Parakeet-MLX requires**: Python >= 3.10
- **Pre-built wheels compatible**: Python 3.10 has working llvmlite wheels
- **macOS friendly**: No build issues with system libraries

Older versions (3.9) lack Parakeet-MLX support. Newer versions (3.11+) have llvmlite dylib compatibility issues on macOS that require system library workarounds.

## Troubleshooting

### "Library not loaded: libz.1.dylib"
You're using Python 3.11+. Use 3.10 instead:
```bash
uv run --python 3.10 stt_parakeet.py
```

### "No microphone input"
Check portaudio installation:
```bash
brew install portaudio
```

### Cache issues
Clear and reinstall:
```bash
rm -rf ~/.cache/uv
uv run --python 3.10 stt_parakeet.py
```

## Advanced: Using Alternate Python Versions

You can specify any installed Python:
```bash
# Use system Python 3.10
/usr/bin/python3.10 stt_parakeet.py

# Use Homebrew Python 3.10
/opt/homebrew/bin/python3.10 stt_parakeet.py
```

But `uv run --python 3.10` is the easiest since uv manages downloads automatically.
