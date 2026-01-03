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
        self.audio_dir = Path("recordings")
        self.audio_dir.mkdir(exist_ok=True)
        self.session_start = datetime.now()
        self.session_id = self.session_start.strftime('%Y%m%d_%H%M%S')
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

    def merge_audio_files(self):
        """Merge all segment audio files into one."""
        audio_files = sorted(self.audio_dir.glob(f"session_{self.session_id}_segment_*.wav"))
        
        if not audio_files:
            logger.warning("No audio files to merge")
            return None
        
        logger.info(f"Merging {len(audio_files)} audio segments...")
        
        merged_audio = []
        for audio_file in audio_files:
            audio, sr = sf.read(audio_file)
            merged_audio.append(audio)
        
        # Concatenate all audio segments
        merged = np.concatenate(merged_audio)
        
        # Save merged audio
        merged_file = self.audio_dir / f"session_{self.session_id}_merged.wav"
        sf.write(merged_file, merged, 16000)
        logger.info(f"✓ Merged audio saved: {merged_file.name}")
        
        return merged_file

    def transcribe_best_quality(self, audio_file):
        """Transcribe with best quality settings."""
        try:
            logger.info("🎯 Running best-quality transcription...")
            result = self.model.transcribe(str(audio_file))
            return result.text.strip()
        except Exception as e:
            logger.error(f"Transcribe failed: {e}")
            return ""

    def save_clean_transcript(self, text):
        """Save clean transcript to separate file."""
        if not text:
            return None
        
        clean_file = self.session_dir / f"session_{self.session_id}_clean.txt"
        with open(clean_file, "w") as f:
            f.write(text)
        
        logger.info(f"✓ Clean transcript saved: {clean_file.name}")
        return clean_file

    @staticmethod
    def prompt_yes_no(question: str) -> bool:
        """Ask yes/no question."""
        while True:
            response = input(f"\n{question} (y/n): ").strip().lower()
            if response in ["y", "yes"]:
                return True
            elif response in ["n", "no"]:
                return False
            else:
                logger.warning("Please enter 'y' or 'n'")

    def save_transcript(self, text, audio_file):
        """Save transcript with timestamp and audio reference."""
        if not text:
            return None
        
        self.transcript_count += 1
        timestamp = datetime.now().strftime("%H:%M:%S")
        
        # Save to session file
        session_file = self.session_dir / f"session_{self.session_id}.txt"
        with open(session_file, "a") as f:
            f.write(f"[{timestamp}] {text}\n")
            f.write(f"  Audio: {audio_file.name}\n")
        
        self.session_log.append({"time": timestamp, "text": text, "audio": str(audio_file)})
        logger.info(f"📝 [{timestamp}] {text}")
        logger.info(f"   🎵 Saved: {audio_file.name}")
        
        return session_file

    def run_continuous(self):
        """Run continuous recording loop."""
        logger.info("=" * 50)
        logger.info("Continuous STT Session")
        logger.info(f"Transcripts: {self.session_dir}")
        logger.info(f"Audio: {self.audio_dir}")
        logger.info("Press Ctrl+C to stop")
        logger.info("=" * 50)
        
        segment_num = 0
        try:
            while True:
                segment_num += 1
                logger.info(f"🎤 Recording segment {segment_num} (5s)...")
                audio = self.record_segment(5.0)
                
                # Save audio
                logger.debug(f"Saving audio to {self.audio_dir}")
                audio_file = self.save_audio(audio, segment_num)
                logger.info(f"💾 Saved: {audio_file}")
                
                # Transcribe
                text = self.transcribe(str(audio_file))
                
                if text:
                    self.save_transcript(text, audio_file)
                else:
                    logger.debug("⏭ No speech detected")
                
        except KeyboardInterrupt:
            logger.info("\n" + "=" * 50)
            logger.info(f"Session ended - {self.transcript_count} transcripts, {segment_num} segments")
            session_file = self.session_dir / f"session_{self.session_id}.txt"
            if session_file.exists():
                logger.info(f"Transcripts: {session_file}")
            logger.info(f"Audio files: {self.audio_dir}/session_{self.session_id}_*.wav")
            logger.info("=" * 50)
            
            # Post-session processing
            self.post_session_processing(segment_num)

    def post_session_processing(self, segment_num):
        """Handle post-session merging and clean transcription."""
        if segment_num < 2:
            logger.info("Only 1 segment recorded, skipping merge")
            return
        
        # Ask about merging
        if self.prompt_yes_no("Merge all recordings into a single audio file?"):
            merged_file = self.merge_audio_files()
            
            if merged_file and self.prompt_yes_no("Generate clean transcript from merged audio?"):
                text = self.transcribe_best_quality(merged_file)
                if text:
                    self.save_clean_transcript(text)
                else:
                    logger.warning("Failed to generate clean transcript")
        
        logger.info("Session complete!")


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