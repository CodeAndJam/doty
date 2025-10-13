"""
Transcription module for converting audio to text using speech recognition.
"""

import speech_recognition as sr
import io
import wave
from typing import Optional


class Transcriber:
    """Handles speech-to-text transcription."""
    
    def __init__(self, language: str = "pt-PT", energy_threshold: int = 4000):
        """
        Initialize the transcriber.
        
        Args:
            language: Language code for recognition (e.g., "pt-PT", "pt-BR", "en-US")
            energy_threshold: Energy level for considering audio
        """
        self.recognizer = sr.Recognizer()
        self.language = language
        self.recognizer.energy_threshold = energy_threshold
        
        # Print language configuration on startup
        language_names = {
            "pt-PT": "Portuguese (Portugal)",
            "pt-BR": "Portuguese (Brazil)",
            "en-US": "English (United States)",
            "es-ES": "Spanish (Spain)",
            "fr-FR": "French (France)",
            "de-DE": "German (Germany)"
        }
        lang_name = language_names.get(language, language)
        print(f"🗣️  Transcription language: {lang_name}")
        
    def transcribe(self, audio_data: bytes, sample_rate: int = 16000) -> Optional[str]:
        """
        Transcribe audio data to text.
        
        Args:
            audio_data: Raw audio data (16-bit PCM)
            sample_rate: Sample rate of the audio
            
        Returns:
            Transcribed text or None if transcription failed
        """
        try:
            # Create a WAV file in memory
            wav_io = io.BytesIO()
            with wave.open(wav_io, 'wb') as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(audio_data)
            
            wav_io.seek(0)
            
            # Create AudioData object
            with sr.AudioFile(wav_io) as source:
                audio = self.recognizer.record(source)
            
            # Transcribe using Google Speech Recognition (free)
            # Google's service supports Portuguese well with pt-PT or pt-BR
            text = self.recognizer.recognize_google(audio, language=self.language)
            return text
            
        except sr.UnknownValueError:
            # Speech was unintelligible
            # For Portuguese, this might happen if:
            # - Audio quality is poor
            # - Background noise is high
            # - Wrong language code is configured (pt-PT vs pt-BR)
            return None
        except sr.RequestError as e:
            print(f"Could not request results from speech recognition service; {e}")
            return None
        except Exception as e:
            print(f"Error in transcription: {e}")
            return None
    
    def is_speech_present(self, audio_data: bytes, sample_rate: int = 16000) -> bool:
        """
        Check if speech is present in the audio data.
        
        Args:
            audio_data: Raw audio data
            sample_rate: Sample rate of the audio
            
        Returns:
            True if speech is likely present, False otherwise
        """
        try:
            wav_io = io.BytesIO()
            with wave.open(wav_io, 'wb') as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(audio_data)
            
            wav_io.seek(0)
            
            with sr.AudioFile(wav_io) as source:
                audio = self.recognizer.record(source)
                # Check if the audio has sufficient energy
                return len(audio.frame_data) > 0
                
        except Exception:
            return False
