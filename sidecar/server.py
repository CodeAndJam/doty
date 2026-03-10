#!/usr/bin/env python3
"""
FastAPI sidecar for Doty Electron app.
Wraps NeMo Parakeet-TDT-0.6b-v3 for speech-to-text.
"""

import os
import sys
import logging
import tempfile
from pathlib import Path

os.environ["NUMBA_DISABLE_JIT"] = "1"
logging.basicConfig(level=logging.ERROR)

import numpy as np
import soundfile as sf
import pyaudio
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

# Load NeMo model
try:
    import nemo.collections.asr as nemo_asr

    print("[sidecar] Loading Parakeet model...", flush=True)
    asr_model = nemo_asr.models.ASRModel.from_pretrained("nvidia/parakeet-tdt-0.6b-v3")
    print("[sidecar] Model ready", flush=True)
except Exception as e:
    print(f"[sidecar] Model load failed: {e}", flush=True)
    sys.exit(1)

app = FastAPI()

SAMPLE_RATE = 16000
SEGMENT_DURATION = 5.0
CHUNK = 4096

recordings_dir = Path("recordings")
recordings_dir.mkdir(exist_ok=True)


class TranscribeRequest(BaseModel):
    wav_path: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/record")
def record():
    """Record a 5-second segment from the microphone and transcribe it."""
    p = pyaudio.PyAudio()
    stream = p.open(
        format=pyaudio.paInt16,
        channels=1,
        rate=SAMPLE_RATE,
        input=True,
        frames_per_buffer=CHUNK,
    )

    frames = []
    num_chunks = int(SAMPLE_RATE * SEGMENT_DURATION / CHUNK)
    for _ in range(num_chunks):
        frames.append(stream.read(CHUNK, exception_on_overflow=False))

    stream.stop_stream()
    stream.close()
    p.terminate()

    audio = np.frombuffer(b"".join(frames), dtype=np.int16).astype(np.float32) / 32768.0

    # Save to temp wav
    with tempfile.NamedTemporaryFile(
        suffix=".wav", dir=str(recordings_dir), delete=False
    ) as f:
        wav_path = f.name

    sf.write(wav_path, audio, SAMPLE_RATE)

    text = _transcribe(wav_path)
    return {"text": text, "wav_path": wav_path}


@app.post("/transcribe")
def transcribe(req: TranscribeRequest):
    """Transcribe an existing wav file."""
    if not Path(req.wav_path).exists():
        raise HTTPException(status_code=404, detail="File not found")
    text = _transcribe(req.wav_path)
    return {"text": text}


def _transcribe(wav_path: str) -> str:
    try:
        output = asr_model.transcribe([wav_path])
        return output[0].text.strip() if output else ""
    except Exception as e:
        print(f"[sidecar] Transcribe error: {e}", flush=True)
        return ""


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="error")
