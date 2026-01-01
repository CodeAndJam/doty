#!/usr/bin/env python3
"""
Simple STT using Parakeet-MLX directly with PyAudio microphone input.
No Pipecat complexity - just raw audio processing.
"""

# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "parakeet-mlx>=0.2.0",
#     "mlx>=0.21.0",
#     "soundfile>=0.12.1",
#     "numpy>=1.26.0",
#     "loguru>=0.7.2",
#     "pyaudio>=0.2.14",
# ]
# ///

import asyncio
import sys
import logging
from pathlib import Path
import tempfile

from loguru import logger
logger.remove()
logger.add(sys.stderr, level="INFO", format="<level>[{level}]</level> {message}")

logging.basicConfig(level=logging.WARNING)

try:
    from parakeet_mlx import from_pretrained
except ImportError:
    logger.error("parakeet-mlx not available")
    sys.exit(1)

try:
    import pyaudio
    import numpy as np
    import soundfile as sf
except ImportError as e:
    logger.error(f"Missing dependency: {e}")
    sys.exit(1)


class ParakeetSTT:
    """Simple STT using Parakeet-MLX on macOS with Apple Silicon."""
    
    def __init__(self):
        logger.info("Loading Parakeet-MLX model...")
        self.model = from_pretrained("mlx-community/parakeet-tdt-0.6b-v3")
        logger.info("✓ Model ready")
        
        # Audio settings
        self.CHUNK = 4096
        self.FORMAT = pyaudio.paInt16
        self.CHANNELS = 1
        self.RATE = 16000
        
    def transcribe_audio_file(self, filepath: str) -> str:
        """Transcribe an audio file."""
        try:
            result = self.model.transcribe(filepath)
            return result.text
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return ""
    
    async def record_and_transcribe(self, duration: float = 5.0) -> str:
        """Record audio for N seconds and transcribe it."""
        logger.info(f"Recording for {duration} seconds...")
        
        p = pyaudio.PyAudio()
        stream = p.open(
            format=self.FORMAT,
            channels=self.CHANNELS,
            rate=self.RATE,
            input=True,
            frames_per_buffer=self.CHUNK,
        )
        
        frames = []
        num_chunks = int(self.RATE / self.CHUNK * duration)
        
        for i in range(num_chunks):
            data = stream.read(self.CHUNK)
            frames.append(data)
            if (i + 1) % 10 == 0:
                logger.debug(f"  {(i+1)*self.CHUNK//self.RATE:.1f}s recorded...")
        
        stream.stop_stream()
        stream.close()
        p.terminate()
        
        logger.info("✓ Recording complete, transcribing...")
        
        # Convert to audio array
        audio_data = np.frombuffer(b"".join(frames), dtype=np.int16).astype(np.float32) / 32768.0
        
        # Save to temp file and transcribe
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name
            sf.write(tmp_path, audio_data, self.RATE)
        
        text = self.transcribe_audio_file(tmp_path)
        Path(tmp_path).unlink()
        
        return text


async def main():
    stt = ParakeetSTT()
    
    logger.info("=" * 60)
    logger.info("🎤 STT Ready - Speak into microphone (5 seconds)")
    logger.info("=" * 60)
    
    text = await stt.record_and_transcribe(duration=5.0)
    
    if text:
        logger.info(f"📝 Transcription: {text}")
    else:
        logger.info("No speech detected")


if __name__ == "__main__":
    asyncio.run(main())
