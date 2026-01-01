import asyncio
import torch
import numpy as np
import tempfile
import soundfile as sf
from datetime import datetime
from typing import AsyncGenerator, Optional

from loguru import logger
from pipecat.frames.frames import Frame, TranscriptionFrame, InterimTranscriptionFrame, AudioRawFrame
from pipecat.services.ai_services import STTService

try:
    import nemo.collections.asr as nemo_asr
except ImportError:
    logger.error("NeMo ASR not found. Please install nemo_toolkit.")

class NeMoModelManager:
    """Singleton to manage the NeMo model instance."""
    _instance = None
    _model = None

    @classmethod
    def get_model(cls, model_name: str = "nvidia/parakeet-tdt-0.6b-v3", device: Optional[str] = None):
        if cls._model is None:
            if device:
                selected_device = torch.device(device)
            elif torch.backends.mps.is_available():
                selected_device = torch.device("mps")
            elif torch.cuda.is_available():
                selected_device = torch.device("cuda")
            else:
                selected_device = torch.device("cpu")
                
            logger.info(f"Loading shared NeMo model {model_name} on {selected_device}...")
            cls._model = nemo_asr.models.ASRModel.from_pretrained(model_name).to(selected_device)
            cls._model.eval()
            logger.success("Shared NeMo model loaded.")
        return cls._model

class NeMoParakeetSTTService(STTService):
    """
    Pipecat STT Service using local NVIDIA NeMo Parakeet TDT model.
    Uses a shared model instance.
    """
    def __init__(self, model_name: str = "nvidia/parakeet-tdt-0.6b-v3", device: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self._model = NeMoModelManager.get_model(model_name, device)
        self._audio_buffer = []

    async def process_frame(self, frame: Frame, direction):
        await super().process_frame(frame, direction)

        if isinstance(frame, AudioRawFrame):
            self._audio_buffer.append(frame.audio)
            
            # Transcribe in ~2s chunks
            if len(self._audio_buffer) >= 20: 
                await self._run_inference(direction)

    async def _run_inference(self, direction):
        if not self._audio_buffer:
            return

        audio_data = b"".join(self._audio_buffer)
        self._audio_buffer = []

        audio_int16 = np.frombuffer(audio_data, dtype=np.int16)
        audio_float32 = audio_int16.astype(np.float32) / 32768.0

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as temp_wav:
            sf.write(temp_wav.name, audio_float32, 16000)
            
            try:
                loop = asyncio.get_event_loop()
                transcriptions = await loop.run_in_executor(
                    None, 
                    lambda: self._model.transcribe([temp_wav.name], verbose=False)
                )
                
                if transcriptions and transcriptions[0]:
                    text = transcriptions[0].strip()
                    if text:
                        # TranscriptionFrame(text, user_id, timestamp)
                        await self.push_frame(
                            TranscriptionFrame(text, "user", datetime.now().isoformat()), 
                            direction
                        )
            except Exception as e:
                logger.error(f"NeMo inference error: {e}")
