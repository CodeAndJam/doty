"""
Main application for the music recommendation system.
"""

import sys
import time
import yaml
import argparse
from typing import Optional, List, Dict
from pathlib import Path

# Import modules (audio_capture might not be available without PyAudio)
try:
    from audio_capture import AudioCapture
    AUDIO_AVAILABLE = True
except ImportError:
    AUDIO_AVAILABLE = False
    print("Warning: PyAudio not available. Audio capture will be disabled.")

from transcription import Transcriber
from llm_client import LLMClient
from music_manager import MusicManager


class MusicRecommendationApp:
    """Main application for music recommendation."""
    
    def __init__(self, config_path: str = "config.yaml"):
        """
        Initialize the application.
        
        Args:
            config_path: Path to configuration file
        """
        self.config = self._load_config(config_path)
        self.mode = self.config.get('mode', {}).get('default', 'copilot')
        
        # Initialize components
        audio_config = self.config.get('audio', {})
        if AUDIO_AVAILABLE:
            self.audio_capture = AudioCapture(
                sample_rate=audio_config.get('sample_rate', 16000),
                chunk_duration=audio_config.get('chunk_duration', 5),
                device_index=audio_config.get('device_index')
            )
        else:
            self.audio_capture = None
            print("⚠️  Audio capture not available. Install PyAudio to enable audio features.")
        
        transcription_config = self.config.get('transcription', {})
        self.transcriber = Transcriber(
            language=transcription_config.get('language', 'en-US'),
            energy_threshold=transcription_config.get('energy_threshold', 4000)
        )
        
        llm_config = self.config.get('llm', {})
        self.llm_client = LLMClient(
            provider=llm_config.get('provider', 'openai'),
            api_key=llm_config.get('api_key'),
            base_url=llm_config.get('base_url', 'https://api.openai.com/v1'),
            model=llm_config.get('model', 'gpt-3.5-turbo')
        )
        
        music_config = self.config.get('music', {})
        self.music_manager = MusicManager(
            local_folder=music_config.get('local_folder'),
            youtube_playlist=music_config.get('youtube_playlist')
        )
        
        self.current_transcript = ""
        self.last_recommendation_time = 0
        self.current_music = None
        
    def _load_config(self, config_path: str) -> dict:
        """Load configuration from YAML file."""
        try:
            with open(config_path, 'r') as f:
                return yaml.safe_load(f)
        except FileNotFoundError:
            print(f"Config file not found: {config_path}")
            print("Using example configuration...")
            # Return a minimal config
            return {
                'llm': {
                    'provider': 'openai',
                    'model': 'gpt-3.5-turbo'
                },
                'audio': {},
                'transcription': {},
                'music': {},
                'mode': {'default': 'copilot'}
            }
    
    def on_audio_captured(self, audio_data: bytes):
        """Callback when audio is captured."""
        # Transcribe audio
        transcript = self.transcriber.transcribe(
            audio_data, 
            self.audio_capture.sample_rate
        )
        
        if transcript:
            print(f"\n🎤 Detected: {transcript}")
            self.current_transcript = transcript
            
            # Generate recommendations
            self._process_transcript(transcript)
    
    def _process_transcript(self, transcript: str):
        """Process transcript and generate music recommendations."""
        music_titles = self.music_manager.get_music_titles()
        
        if not music_titles:
            print("❌ No music available. Please configure music sources.")
            return
        
        print(f"\n🤔 Analyzing conversation with {len(music_titles)} available tracks...")
        
        # Get recommendations from LLM
        rankings = self.llm_client.rank_music(transcript, music_titles)
        
        if self.mode == 'copilot':
            self._copilot_mode(rankings)
        elif self.mode == 'auto':
            self._auto_mode(rankings)
    
    def _copilot_mode(self, rankings: List[Dict[str, any]]):
        """Copilot mode: Show recommendations for user selection."""
        print("\n🎵 Music Recommendations:")
        print("=" * 60)
        
        for i, item in enumerate(rankings, 1):
            print(f"\n{i}. {item['title']}")
            print(f"   Confidence: {item['score']:.1%}")
            print(f"   Reason: {item['reason']}")
        
        print("\n" + "=" * 60)
        print("\nEnter the number to play (1-5), or 's' to skip: ", end='', flush=True)
    
    def _auto_mode(self, rankings: List[Dict[str, any]]):
        """Auto mode: Automatically select and play music."""
        if rankings:
            best_match = rankings[0]
            print(f"\n🎵 Auto-selecting: {best_match['title']}")
            print(f"   Confidence: {best_match['score']:.1%}")
            print(f"   Reason: {best_match['reason']}")
            
            music_item = self.music_manager.get_music_by_title(best_match['title'])
            if music_item:
                self.music_manager.play_music(music_item)
                self.current_music = music_item
                
                # Wait before next auto-switch
                delay = self.config.get('mode', {}).get('auto_switch_delay', 30)
                print(f"\n⏱️  Next check in {delay} seconds...")
    
    def run(self, mode: Optional[str] = None):
        """
        Run the application.
        
        Args:
            mode: Operating mode ('copilot' or 'auto'), overrides config
        """
        if not AUDIO_AVAILABLE:
            print("❌ Cannot run: PyAudio is not installed.")
            print("Install it with: pip install pyaudio")
            print("On macOS: brew install portaudio && pip install pyaudio")
            return
        
        if mode:
            self.mode = mode
        
        print("=" * 60)
        print("🎵 Music Recommendation System")
        print("=" * 60)
        print(f"Mode: {self.mode.upper()}")
        
        # Load music list
        print("\n📚 Loading music library...")
        self.music_manager.load_music_list()
        
        if not self.music_manager.music_list:
            print("❌ No music found. Please configure music sources in config.yaml")
            return
        
        print(f"✅ Loaded {len(self.music_manager.music_list)} tracks")
        
        # List available audio devices
        print("\n🎙️  Available audio devices:")
        devices = self.audio_capture.list_devices()
        for device in devices:
            print(f"  [{device['index']}] {device['name']}")
        
        print("\n▶️  Starting audio capture...")
        print("Listening for conversation... (Press Ctrl+C to stop)\n")
        
        # Start audio capture
        self.audio_capture.start_capture(self.on_audio_captured)
        
        try:
            if self.mode == 'copilot':
                # In copilot mode, wait for user input
                while True:
                    user_input = input()
                    if user_input.lower() == 'q':
                        break
                    elif user_input.isdigit():
                        idx = int(user_input) - 1
                        # This would require storing the last rankings
                        # For now, just acknowledge
                        print("Selection acknowledged!")
            else:
                # In auto mode, just keep running
                while True:
                    time.sleep(1)
                    
        except KeyboardInterrupt:
            print("\n\n⏹️  Stopping...")
        finally:
            self.audio_capture.stop_capture()
            print("👋 Goodbye!")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Music Recommendation System - AI-powered music selection based on conversation"
    )
    parser.add_argument(
        '--mode',
        choices=['copilot', 'auto'],
        help='Operating mode: copilot (show recommendations) or auto (automatic selection)'
    )
    parser.add_argument(
        '--config',
        default='config.yaml',
        help='Path to configuration file (default: config.yaml)'
    )
    parser.add_argument(
        '--list-devices',
        action='store_true',
        help='List available audio input devices and exit'
    )
    
    args = parser.parse_args()
    
    if args.list_devices:
        # Just list devices and exit
        if not AUDIO_AVAILABLE:
            print("❌ PyAudio is not installed. Cannot list audio devices.")
            print("Install it with: pip install pyaudio")
            return
        
        capture = AudioCapture()
        print("Available audio input devices:")
        for device in capture.list_devices():
            print(f"  [{device['index']}] {device['name']} ({device['channels']} channels)")
        return
    
    # Run the application
    app = MusicRecommendationApp(config_path=args.config)
    app.run(mode=args.mode)


if __name__ == '__main__':
    main()
