import asyncio
import numpy as np
import mlx.core as mx
from datetime import datetime
from typing import Optional
from loguru import logger

from pipecat.frames.frames import Frame, TranscriptionFrame, AudioRawFrame
from pipecat.services.stt_service import STTService

try:
    from parakeet_mlx import from_pretrained
    from parakeet_mlx.audio import get_logmel
except ImportError:
    logger.error("parakeet-mlx not available. Ensure it is installed in the current environment.")

class MLXModelManager:
    """Singleton to manage the Parakeet-MLX model instance."""
    _model = None

    @classmethod
    def get_model(cls, model_name: str = "parakeet-tdt-0.6b-v3"):
        if cls._model is None:
            # Note: parakeet-mlx 0.4.1 uses from_pretrained
            # hf_id for parakeet-tdt-0.6b-v3 is usually "nvidia/parakeet-tdt-0.6b-v3"
            # but the library might map the short name.
            logger.info(f"Loading shared Parakeet-MLX model: {model_name}...")
            cls._model = from_pretrained(model_name)
            logger.success("Shared Parakeet-MLX model loaded.")
        return cls._model

class MLXSTTService(STTService):
    """
    Pipecat STT Service using Parakeet-MLX (0.4.1+ API).
    Optimized for high-speed local inference on Apple Silicon (M4).
    """
    def __init__(self, model_name: str = "parakeet-tdt-0.6b-v3", **kwargs):
        super().__init__(**kwargs)
        self._model = MLXModelManager.get_model(model_name)
        self._audio_buffer = []

    async def process_frame(self, frame: Frame, direction):
        await super().process_frame(frame, direction)

        if isinstance(frame, AudioRawFrame):
            self._audio_buffer.append(frame.audio)
            
            # Collect ~2 seconds of audio (32000 samples @ 16kHz)
            # 20 * 100ms frames = 2 seconds
            if len(self._audio_buffer) >= 20: 
                await self._run_inference(direction)

    async def _run_inference(self, direction):
        if not self._audio_buffer:
            return

        audio_bytes = b"".join(self._audio_buffer)
        self._audio_buffer = []

        try:
            # 1. Convert PCM16 bytes to mx.array
            audio_int16 = np.frombuffer(audio_bytes, dtype=np.int16)
            audio_float32 = audio_int16.astype(np.float32) / 32768.0
            audio_mx = mx.array(audio_float32)

            # 2. Extract Mel Spectrogram
            # Note: get_logmel expects (mx_array, preprocessor_config)
            mel = get_logmel(audio_mx, self._model.preprocessor_config)
            
            # 3. Generate transcription
            # Offload to executor to keep event loop free
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None, 
                lambda: self._model.generate(mel)
            )
            
            # Result is AlignedResult which has .text
            text = " ".join(a.text for a in result).strip()
            
            if text:
                logger.debug(f"MLX STT: {text}")
                await self.push_frame(
                    TranscriptionFrame(text, "user", datetime.now().isoformat()), 
                    direction
                )
        except Exception as e:
            logger.error(f"MLX inference error: {e}")
            import traceback
            logger.error(traceback.format_exc())
