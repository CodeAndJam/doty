#!/usr/bin/env python3
"""
Pure MLX STT - Minimal dependencies, works on macOS Apple Silicon.

Usage:
  python stt_parakeet.py
"""

# /// script
# requires-python = ">=3.10,<3.11"
# dependencies = [
#     "parakeet-mlx>=0.4.0",
#     "mlx>=0.30.0",
#     "soundfile>=0.13.0",
#     "numpy>=1.20.0",
#     "loguru>=0.7.0",
#     "pyaudio>=0.2.14",
# ]
# ///

import sys
import os
import logging
from pathlib import Path
import tempfile
import subprocess

# Disable numba JIT to avoid llvmlite issues
os.environ["NUMBA_DISABLE_JIT"] = "1"
logging.basicConfig(level=logging.ERROR)

from loguru import logger
logger.remove()
logger.add(sys.stderr, level="INFO", format="<level>[{level}]</level> {message}")

# Core imports
try:
    import numpy as np
    import soundfile as sf
    import pyaudio
    import mlx.core as mx  # noqa
    from parakeet_mlx import from_pretrained
except ImportError as e:
    logger.error(f"Import failed: {e}")
    sys.exit(1)


class SimpleSTT:
    """Parakeet-MLX STT - Minimal, reliable."""

    def __init__(self):
        logger.info("Loading model...")
        try:
            self.model = from_pretrained("mlx-community/parakeet-tdt-0.6b-v3")
            logger.info("✓ Ready")
        except Exception as e:
            logger.error(f"Load failed: {e}")
            raise

    def record(self, seconds=5.0):
        """Record audio from mic."""
        logger.info(f"🎤 Recording {int(seconds)}s...")
        
        p = pyaudio.PyAudio()
        stream = p.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=16000,
            input=True,
            frames_per_buffer=4096,
        )
        
        frames = []
        for _ in range(int(16000 * seconds / 4096)):
            frames.append(stream.read(4096, exception_on_overflow=False))
        
        stream.stop_stream()
        stream.close()
        p.terminate()
        
        audio = np.frombuffer(b"".join(frames), dtype=np.int16)
        return audio.astype(np.float32) / 32768.0

    def transcribe(self, audio_file):
        """Transcribe audio file."""
        try:
            logger.info("Transcribing...")
            result = self.model.transcribe(audio_file)
            return result.text.strip()
        except Exception as e:
            logger.error(f"Failed: {e}")
            return ""


def main():
    logger.info("=" * 50)
    logger.info("Parakeet-MLX Local STT")
    logger.info("=" * 50)
    
    try:
        stt = SimpleSTT()
        audio = stt.record(5.0)
        
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            path = f.name
            sf.write(path, audio, 16000)
        
        text = stt.transcribe(path)
        Path(path).unlink()
        
        if text:
            logger.info(f"📝 {text}")
        else:
            logger.warning("No speech")
            
    except KeyboardInterrupt:
        logger.info("Cancelled")
    except Exception as e:
        logger.error(f"Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()