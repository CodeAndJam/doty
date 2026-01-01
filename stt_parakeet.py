#!/usr/bin/env python3
"""
Continuous STT using Parakeet-MLX with session-based file management.

Records until stopped (Ctrl+C), saving transcriptions with timestamps.
Each session creates timestamped files for organization.

Usage:
  uv run --python 3.10 stt_parakeet.py
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
from datetime import datetime

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


class ContinuousSTT:
    """Continuous STT with session-based file management."""

    def __init__(self):
        logger.info("Loading model...")
        try:
            self.model = from_pretrained("mlx-community/parakeet-tdt-0.6b-v3")
            logger.info("✓ Ready")
        except Exception as e:
            logger.error(f"Load failed: {e}")
            raise
        
        # Session setup
        self.session_dir = Path("transcriptions")
        self.session_dir.mkdir(exist_ok=True)
        self.session_start = datetime.now()
        self.transcript_count = 0
        self.session_log = []

    def record_segment(self, duration=5.0):
        """Record a single audio segment."""
        p = pyaudio.PyAudio()
        stream = p.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=16000,
            input=True,
            frames_per_buffer=4096,
        )
        
        frames = []
        for _ in range(int(16000 * duration / 4096)):
            frames.append(stream.read(4096, exception_on_overflow=False))
        
        stream.stop_stream()
        stream.close()
        p.terminate()
        
        audio = np.frombuffer(b"".join(frames), dtype=np.int16)
        return audio.astype(np.float32) / 32768.0

    def transcribe(self, audio_file):
        """Transcribe audio file."""
        try:
            result = self.model.transcribe(audio_file)
            return result.text.strip()
        except Exception as e:
            logger.error(f"Transcribe failed: {e}")
            return ""

    def save_transcript(self, text):
        """Save transcript with timestamp."""
        if not text:
            return None
        
        self.transcript_count += 1
        timestamp = datetime.now().strftime("%H:%M:%S")
        
        # Save to session file
        session_file = self.session_dir / f"session_{self.session_start.strftime('%Y%m%d_%H%M%S')}.txt"
        with open(session_file, "a") as f:
            f.write(f"[{timestamp}] {text}\n")
        
        self.session_log.append({"time": timestamp, "text": text})
        logger.info(f"📝 [{timestamp}] {text}")
        
        return session_file

    def run_continuous(self):
        """Run continuous recording loop."""
        logger.info("=" * 50)
        logger.info("Continuous STT Session")
        logger.info(f"Session dir: {self.session_dir}")
        logger.info("Press Ctrl+C to stop")
        logger.info("=" * 50)
        
        try:
            while True:
                logger.info("🎤 Recording 5s...")
                audio = self.record_segment(5.0)
                
                # Transcribe
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                    path = f.name
                    sf.write(path, audio, 16000)
                
                text = self.transcribe(path)
                Path(path).unlink()
                
                if text:
                    self.save_transcript(text)
                else:
                    logger.debug("⏭ No speech detected")
                
        except KeyboardInterrupt:
            logger.info("\n" + "=" * 50)
            logger.info(f"Session ended - {self.transcript_count} transcripts")
            session_file = self.session_dir / f"session_{self.session_start.strftime('%Y%m%d_%H%M%S')}.txt"
            if session_file.exists():
                logger.info(f"Saved to: {session_file}")
            logger.info("=" * 50)


def main():
    """Main entry point."""
    try:
        stt = ContinuousSTT()
        stt.run_continuous()
    except Exception as e:
        logger.error(f"Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()