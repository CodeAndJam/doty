"""
Audio capture module for capturing microphone input.
Supports multiple microphones and works primarily on macOS.
"""

import pyaudio
import wave
import threading
import time
from typing import Optional, Callable
import numpy as np


class AudioCapture:
    """Captures audio from all available microphones."""
    
    def __init__(self, sample_rate: int = 16000, chunk_duration: int = 5, device_index: Optional[int] = None):
        """
        Initialize the audio capture.
        
        Args:
            sample_rate: Sample rate for audio capture
            chunk_duration: Duration in seconds to capture before processing
            device_index: Specific device index, None for default
        """
        self.sample_rate = sample_rate
        self.chunk_duration = chunk_duration
        self.device_index = device_index
        self.is_capturing = False
        self.audio_callback: Optional[Callable] = None
        self.pyaudio = pyaudio.PyAudio()
        
    def list_devices(self):
        """List all available audio input devices."""
        devices = []
        for i in range(self.pyaudio.get_device_count()):
            device_info = self.pyaudio.get_device_info_by_index(i)
            if device_info['maxInputChannels'] > 0:
                devices.append({
                    'index': i,
                    'name': device_info['name'],
                    'channels': device_info['maxInputChannels'],
                    'sample_rate': int(device_info['defaultSampleRate'])
                })
        return devices
    
    def start_capture(self, callback: Callable[[bytes], None]):
        """
        Start capturing audio and call the callback with audio data.
        
        Args:
            callback: Function to call with captured audio data
        """
        self.audio_callback = callback
        self.is_capturing = True
        
        # Start capture thread
        capture_thread = threading.Thread(target=self._capture_loop)
        capture_thread.daemon = True
        capture_thread.start()
        
    def _capture_loop(self):
        """Main capture loop running in a separate thread."""
        chunk_size = int(self.sample_rate * 0.1)  # 100ms chunks
        chunks_per_callback = int(self.chunk_duration / 0.1)
        
        try:
            stream = self.pyaudio.open(
                format=pyaudio.paInt16,
                channels=1,
                rate=self.sample_rate,
                input=True,
                input_device_index=self.device_index,
                frames_per_buffer=chunk_size
            )
            
            audio_buffer = []
            chunk_count = 0
            
            while self.is_capturing:
                try:
                    data = stream.read(chunk_size, exception_on_overflow=False)
                    audio_buffer.append(data)
                    chunk_count += 1
                    
                    if chunk_count >= chunks_per_callback:
                        # Combine all chunks and call callback
                        combined_audio = b''.join(audio_buffer)
                        if self.audio_callback:
                            self.audio_callback(combined_audio)
                        audio_buffer = []
                        chunk_count = 0
                        
                except Exception as e:
                    print(f"Error reading audio: {e}")
                    time.sleep(0.1)
                    
            stream.stop_stream()
            stream.close()
            
        except Exception as e:
            print(f"Error in capture loop: {e}")
            self.is_capturing = False
    
    def stop_capture(self):
        """Stop capturing audio."""
        self.is_capturing = False
        time.sleep(0.2)  # Give time for thread to finish
        
    def save_audio(self, audio_data: bytes, filename: str):
        """
        Save audio data to a WAV file.
        
        Args:
            audio_data: Raw audio data
            filename: Output filename
        """
        with wave.open(filename, 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(self.pyaudio.get_sample_size(pyaudio.paInt16))
            wf.setframerate(self.sample_rate)
            wf.writeframes(audio_data)
    
    def __del__(self):
        """Cleanup PyAudio."""
        if hasattr(self, 'pyaudio'):
            self.pyaudio.terminate()
