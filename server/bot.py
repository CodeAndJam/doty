import os
import asyncio
import tempfile
import numpy as np
import torch
from typing import Dict, List, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from dotenv import load_dotenv

from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask
from pipecat.frames.frames import EndFrame, Frame, TranscriptionFrame, MixerUpdateSettingsFrame, MixerEnableFrame
from pipecat.transports.services.daily import DailyTransport
from pipecat.transports.daily.transport import DailyParams
from pipecat.audio.mixers.soundfile_mixer import SoundfileMixer
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.processors.frame_processor import FrameProcessor

from services.mlx_stt import MLXSTTService, MLXModelManager
from music_manager import MusicManager

load_dotenv()

app = FastAPI(title="GM Music Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Resources
mm = MusicManager(base_dir="./music")

class MusicProposalProcessor(FrameProcessor):
    def __init__(self, transport: DailyTransport):
        super().__init__()
        self.transport = transport
        
    async def process_frame(self, frame: Frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame):
            text = frame.text.strip().lower()
            if "batalha" in text:
                await self.transport.send_message({
                    "type": "music_proposal",
                    "data": {"track": "battle_theme.mp3", "reason": "Contexto de combate detectado."}
                })
            elif "sombr" in text or "misterio" in text:
                await self.transport.send_message({
                    "type": "music_proposal",
                    "data": {"track": "ambient_dark.mp3", "reason": "Atmosfera sombria sugerida."}
                })
        await self.push_frame(frame, direction)

async def run_bot(room_url: str, token: Optional[str] = None):
    tracks = mm.get_track_list()
    sound_files = {t: mm.get_full_path(t) for t in tracks}
    
    mixer = SoundfileMixer(
        sound_files=sound_files,
        default_sound=tracks[0] if tracks else "",
        mixing=False
    )

    transport = DailyTransport(
        room_url,
        token,
        "GM Bot",
        DailyParams(
            audio_out_enabled=True,
            audio_out_mixer=mixer,
            vad_enabled=True,
            vad_analyzer=SileroVADAnalyzer()
        )
    )

    stt = MLXSTTService()
    music_proposal = MusicProposalProcessor(transport)

    pipeline = Pipeline([
        transport.input(),
        stt,
        music_proposal,
        transport.output()
    ])

    task = PipelineTask(pipeline)
    runner = PipelineRunner()

    @transport.event_handler("on_app_message")
    async def on_app_message(transport, message, participant_id):
        if message.get("type") == "play_music":
            track_name = message["data"]["track"]
            await task.queue_frame(MixerUpdateSettingsFrame(settings={"sound": track_name, "loop": True}))
            await task.queue_frame(MixerEnableFrame(enable=True))

    try:
        await runner.run(task)
    except Exception as e:
        logger.error(f"Bot session error: {e}")
    finally:
        await task.queue_frame(EndFrame())

# --- REST Endpoints ---

@app.post("/start_bot")
async def start_bot_endpoint(room_url: str):
    logger.info(f"Triggering bot for: {room_url}")
    asyncio.create_task(run_bot(room_url))
    return {"status": "starting", "room": room_url}

@app.post("/transcribe")
async def transcribe_file(file: UploadFile = File(...)):
    from parakeet_mlx.audio import load_audio, get_logmel
    
    content = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        model = MLXModelManager.get_model()
        audio = load_audio(tmp_path, model.preprocessor_config.sample_rate)
        mel = get_logmel(audio, model.preprocessor_config)
        result = model.generate(mel)
        text = " ".join(a.text for a in result).strip()
        return {"text": text}
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@app.get("/healthz")
async def health():
    return {"status": "ok", "engine": "parakeet-mlx"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
