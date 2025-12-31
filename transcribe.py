
import asyncio
import sys
from loguru import logger

from pipecat.frames.frames import EndFrame, TranscriptionFrame, InterimTranscriptionFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.services.whisper.stt import WhisperSTTService, Model
from pipecat.transcriptions.language import Language
from pipecat.transports.local.audio import LocalAudioTransport, LocalAudioTransportParams
from pipecat.audio.vad.silero import SileroVADAnalyzer

class TranscriptWriter(FrameProcessor):
    """
    A processor that writes transcription text to a file and console in real-time.
    """
    def __init__(self, filename="portuguese_transcription.txt"):
        super().__init__()
        self.filename = filename
        try:
            self.file = open(self.filename, "w", encoding="utf-8")
            self.file.write("--- Transcription Started ---\n")
            self.file.flush()
            logger.info(f"Writing transcription to {self.filename}")
        except Exception as e:
            logger.error(f"Failed to initialize transcript file: {e}")
            self.file = None

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        
        if isinstance(frame, TranscriptionFrame):
            text = frame.text.strip()
            if text:
                # Log to loguru (appears in console with Pipecat logs)
                logger.info(f"Final: {text}")
                # Print to stdout for immediate visibility without log metadata
                print(f"\n[PT-Final] {text}", flush=True)
                
                if self.file:
                    try:
                        self.file.write(f"{text}\n")
                        self.file.flush()
                    except Exception as e:
                        logger.error(f"Error writing to file: {e}")
        
        elif isinstance(frame, InterimTranscriptionFrame):
            text = frame.text.strip()
            if text:
                # Interim results are printed to stay "scrolling"
                # Use \r to overwrite line if we want, but for now just print
                print(f"[PT-Interim] {text}", end="\r", flush=True)
        
        await self.push_frame(frame, direction)

    async def cleanup(self):
        if self.file:
            self.file.close()

async def main():
    logger.info("Initializing Pipecat Portuguese Transcriber with VAD...")

    # 1. Transport (Local Microphone)
    # We add a VAD analyzer to detect speech segments.
    # Without VAD, the STT service won't know when to process audio.
    transport = LocalAudioTransport(
        params=LocalAudioTransportParams(
            audio_out_enabled=False,
            audio_out_sample_rate=16000, 
            audio_in_sample_rate=16000,
            audio_in_channels=1,
            audio_in_enabled=True,
            vad_analyzer=SileroVADAnalyzer()
        )
    )

    # 2. STT Service (Whisper Local)
    try:
        stt = WhisperSTTService(
            model=Model.LARGE,
            device="auto",
            language=Language.PT
        )
    except Exception as e:
        logger.error(f"Failed to initialize WhisperSTTService: {e}")
        return

    # 3. Output Processor
    writer = TranscriptWriter(filename="portuguese_transcription.txt")

    # 4. Pipeline Configuration
    pipeline = Pipeline(
        [
            transport.input(),   # Microphone input
            stt,                 # Speech-to-Text
            writer               # Write to file and console
        ]
    )

    # 5. Task & Runner
    task = PipelineTask(pipeline)
    runner = PipelineRunner()

    logger.info("Starting pipeline. Speak into your microphone (Portuguese). Press Ctrl+C to stop.")

    try:
        await runner.run(task)
    except KeyboardInterrupt:
        logger.info("Stopping...")
    finally:
        await task.queue_frame(EndFrame())

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
