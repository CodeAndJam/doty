# STT Setup Instructions for macOS

## Issue
The `stt_parakeet.py` script fails with:
```
OSError: dlopen(.../libllvmlite.dylib): Library not loaded: @rpath/libz.1.dylib
```

This is due to llvmlite (used by numba → librosa → parakeet-mlx) having broken library paths on macOS.

## Solution 1: Use Conda (Recommended)

Conda handles system dependencies automatically and works perfectly:

```bash
conda create -n doty python=3.11
conda activate doty
conda install -c conda-forge parakeet-mlx mlx soundfile pyaudio numpy loguru
python stt_parakeet.py
```

## Solution 2: Fix Library Paths (Manual)

Create a symlink and export library path:

```bash
# Create library directory
mkdir -p ~/lib

# Link zlib
ln -sf /opt/homebrew/opt/zlib/lib/libz.1.dylib ~/lib/libz.1.dylib

# Run with library path
export DYLD_LIBRARY_PATH=~/lib:$DYLD_LIBRARY_PATH
.venv/bin/python stt_parakeet.py
```

Or use the wrapper script:
```bash
chmod +x run_stt.sh
./run_stt.sh
```

## Solution 3: Use Homebrew Python

```bash
brew install python@3.11
/opt/homebrew/bin/python3.11 -m pip install parakeet-mlx mlx soundfile pyaudio numpy loguru
/opt/homebrew/bin/python3.11 stt_parakeet.py
```

## Dependencies

Required packages:
- parakeet-mlx>=0.4.0 - Speech recognition model
- mlx>=0.30.0 - Apple Silicon ML framework  
- soundfile>=0.13.0 - Audio file I/O
- numpy>=2.0.0 - Numerical computing
- loguru>=0.7.0 - Logging
- pyaudio>=0.2.14 - Microphone input

System requirements:
- portaudio (for pyaudio): `brew install portaudio`
- zlib (for llvmlite): `brew install zlib`
- Python 3.11+ (3.12 has issues with old numba/llvmlite versions)

## Testing

Test audio recording:
```bash
.venv/bin/python -c "import pyaudio; p = pyaudio.PyAudio(); print('✓ PyAudio OK')"
```

Test MLX:
```bash
.venv/bin/python -c "import mlx.core; print('✓ MLX OK')"
```

Test Parakeet-MLX:
```bash
.venv/bin/python -c "from parakeet_mlx import from_pretrained; print('✓ Parakeet-MLX importing...')"
```

## Reference

- Parakeet-MLX: https://github.com/JosefAlbers/parakeet-mlx
- MLX: https://ml-explore.github.io/mlx/
- llvmlite issue: https://github.com/numba/llvmlite/issues
