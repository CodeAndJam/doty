import asyncio
import io
import torch
import numpy as np
from datetime import datetime
from typing import Optional
from faster_whisper import WhisperModel
from loguru import logger

from pipecat.frames.frames import Frame, TranscriptionFrame, AudioRawFrame
from pipecat.services.stt_service import STTService

class WhisperModelManager:
    """Singleton to manage the Whisper model instance."""
    _model = None

    @classmethod
    def get_model(cls, model_size: str = "base", device: Optional[str] = None):
        if cls._model is None:
            if device is None:
                # Optimized for Apple Silicon
                device = "cpu" # faster-whisper mps is still experimental in some environments
                compute_type = "float32"
            else:
                compute_type = "default"
            
            logger.info(f"Loading shared Faster-Whisper model {model_size} on {device}...")
            # We use cpu with 4 cores for high efficiency on M4
            cls._model = WhisperModel(model_size, device=device, compute_type=compute_type, cpu_threads=4)
            logger.success("Shared Faster-Whisper model loaded.")
        return cls._model

class WhisperSTTService(STTService):
    """
    Pipecat STT Service using Faster-Whisper.
    Optimized for stable Mac ARM performance.
    """
    def __init__(self, model_size: str = "base", device: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self._model = WhisperModelManager.get_model(model_size, device)
        self._audio_buffer = []

    async def process_frame(self, frame: Frame, direction):
        await super().process_frame(frame, direction)

        if isinstance(frame, AudioRawFrame):
            self._audio_buffer.append(frame.audio)
            
            # Transcribe in ~2s chunks (20 * 100ms)
            if len(self._audio_buffer) >= 20: 
                await self._run_inference(direction)

    async def _run_inference(self, direction):
        if not self._audio_buffer:
            return

        audio_data = b"".join(self._audio_buffer)
        self._audio_buffer = []

        # Faster-whisper expects float32 np array
        audio_int16 = np.frombuffer(audio_data, dtype=np.int16)
        audio_float32 = audio_int16.astype(np.float32) / 32768.0

        try:
            # Run transcription in thread pool to not block event loop
            loop = asyncio.get_event_loop()
            segments, info = await loop.run_in_executor(
                None, 
                lambda: self._model.transcribe(audio_float32, beam_size=5, language="pt")
            )
            
            full_text = " ".join([segment.text for segment in segments]).strip()
            if full_text:
                logger.debug(f"Whisper STT: {full_text}")
                await self.push_frame(
                    TranscriptionFrame(full_text, "user", datetime.now().isoformat()), 
                    direction
                )
        except Exception as e:
            logger.error(f"Whisper inference error: {e}")
