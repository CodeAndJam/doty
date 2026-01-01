import os
import sys
import torch
import numpy as np
import pyaudio
import tempfile
import soundfile as sf
from datetime import datetime
from loguru import logger
from omegaconf import OmegaConf

# Attempting to import NeMo. We verified this works in the environment.
try:
    import nemo.collections.asr as nemo_asr
except ImportError as e:
    logger.error(f"NeMo ASR not found. Please ensure all dependencies are installed. Error: {e}")
    sys.exit(1)

# Configuration
# The user specified: nvidia/parakeet-tdt-0.6b-v3
MODEL_NAME = "nvidia/parakeet-tdt-0.6b-v3"
SAMPLE_RATE = 16000
CHUNK_SIZE = 16000  # 1.0 seconds of audio per buffer
TRANSCRIPTION_FILE = "portuguese_transcription.txt"

def main():
    logger.info("Initializing GM Transcription Assistant (Direct NeMo Mode)")
    logger.info(f"Model: {MODEL_NAME}")
    
    # Device detection
    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    
    logger.info(f"Selected device: {device}")

    # Load the model
    try:
        # TDT models are often EncDecRNNTBPEModel or similar
        asr_model = nemo_asr.models.ASRModel.from_pretrained(MODEL_NAME).to(device)
        asr_model.eval()
        logger.success("Model loaded successfully.")
    except Exception as e:
        logger.error(f"Error loading NeMo model: {e}")
        return

    # Audio input setup
    p = pyaudio.PyAudio()
    
    # Find default input device
    try:
        default_device_info = p.get_default_input_device_info()
        logger.info(f"Using input device: {default_device_info['name']}")
    except Exception as e:
        logger.error(f"No input device found: {e}")
        return

    stream = p.open(
        format=pyaudio.paInt16,
        channels=1,
        rate=SAMPLE_RATE,
        input=True,
        frames_per_buffer=CHUNK_SIZE
    )

    # Prepare transcription file
    with open(TRANSCRIPTION_FILE, "w", encoding="utf-8") as f:
        f.write(f"--- Sessão iniciada em {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ---\n")
        f.write(f"--- Modelo: {MODEL_NAME} ---\n\n")

    logger.info("Ouvindo... Pressione Ctrl+C para encerrar.")
    
    # Variables for simple energy-based VAD or rolling buffer
    # Note: TDT models are very fast, we can transcribe in 1s windows effectively.
    try:
        while True:
            # Read audio chunk
            try:
                data = stream.read(CHUNK_SIZE, exception_on_overflow=False)
            except Exception as e:
                logger.warning(f"Audio read error: {e}")
                continue

            audio_int16 = np.frombuffer(data, dtype=np.int16)
            
            # Simple energy threshold to avoid unnecessary processing of silence
            energy = np.sqrt(np.mean(audio_int16.astype(float)**2))
            if energy < 50: # Adjust if too sensitive/not sensitive enough
                continue

            # NeMo transcribe() prefers file paths for the public API
            # This is robust and handles all pre/post-processing correctly.
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as temp_wav:
                # Convert to float32 as NeMo expects it
                audio_float32 = audio_int16.astype(np.float32) / 32768.0
                sf.write(temp_wav.name, audio_float32, SAMPLE_RATE)
                
                # Direct inference
                with torch.no_grad():
                    # transcribe() returns a list of strings
                    # We pass a list with one file path
                    transcriptions = asr_model.transcribe([temp_wav.name], verbose=False)
                
                if transcriptions and transcriptions[0]:
                    text = transcriptions[0].strip()
                    if text:
                        timestamp = datetime.now().strftime("%H:%M:%S")
                        entry = f"[{timestamp}] {text}"
                        
                        # Print to console (overwriting the line for a cleaner look if possible, or just normal print)
                        print(f"\r{entry}", flush=True)
                        
                        # Save to file
                        with open(TRANSCRIPTION_FILE, "a", encoding="utf-8") as f:
                            f.write(entry + "\n")
                            f.flush()

    except KeyboardInterrupt:
        logger.info("\nEncerrando assistente de transcrição...")
    finally:
        stream.stop_stream()
        stream.close()
        p.terminate()
        logger.info("Recursos de áudio liberados.")

if __name__ == "__main__":
    main()
