"""
Music manager module for handling music sources (local folder and YouTube playlist).
"""

import os
import json
import yt_dlp
import webbrowser
from typing import List, Dict, Optional
from pathlib import Path

try:
    import pygame
    PYGAME_AVAILABLE = True
except ImportError:
    PYGAME_AVAILABLE = False
    print("Warning: pygame not available. Music playback will be limited.")


class MusicManager:
    """Manages music sources including local folders and YouTube playlists."""
    
    def __init__(self, local_folder: Optional[str] = None, youtube_playlist: Optional[str] = None):
        """
        Initialize the music manager.
        
        Args:
            local_folder: Path to local music folder
            youtube_playlist: YouTube playlist URL
        """
        self.local_folder = local_folder
        self.youtube_playlist = youtube_playlist
        self.music_list: List[Dict[str, str]] = []
        self.is_playing = False
        
        # Initialize pygame mixer if available
        if PYGAME_AVAILABLE:
            try:
                pygame.mixer.init()
                print("✅ Audio playback initialized")
            except Exception as e:
                print(f"⚠️  Could not initialize audio playback: {e}")
        
    def load_music_list(self) -> List[Dict[str, str]]:
        """
        Load music list from configured sources.
        
        Returns:
            List of music items with title and path/url
        """
        self.music_list = []
        
        if self.local_folder:
            self.music_list.extend(self._load_local_music())
        
        if self.youtube_playlist:
            self.music_list.extend(self._load_youtube_playlist())
        
        return self.music_list
    
    def _load_local_music(self) -> List[Dict[str, str]]:
        """Load music from local folder."""
        music_items = []
        
        if not os.path.isdir(self.local_folder):
            print(f"Warning: Local folder not found: {self.local_folder}")
            return music_items
        
        # Supported audio formats
        audio_extensions = {'.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'}
        
        for root, dirs, files in os.walk(self.local_folder):
            for file in files:
                if Path(file).suffix.lower() in audio_extensions:
                    file_path = os.path.join(root, file)
                    # Use filename without extension as title
                    title = Path(file).stem
                    music_items.append({
                        'title': title,
                        'path': file_path,
                        'source': 'local'
                    })
        
        print(f"Loaded {len(music_items)} tracks from local folder")
        return music_items
    
    def _load_youtube_playlist(self) -> List[Dict[str, str]]:
        """Load music from YouTube playlist."""
        music_items = []
        
        try:
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'extract_flat': True,  # Don't download, just get info
            }
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                playlist_info = ydl.extract_info(self.youtube_playlist, download=False)
                
                if 'entries' in playlist_info:
                    for entry in playlist_info['entries']:
                        if entry:
                            music_items.append({
                                'title': entry.get('title', 'Unknown'),
                                'url': entry.get('url', ''),
                                'id': entry.get('id', ''),
                                'source': 'youtube'
                            })
            
            print(f"Loaded {len(music_items)} tracks from YouTube playlist")
            
        except Exception as e:
            print(f"Error loading YouTube playlist: {e}")
        
        return music_items
    
    def get_music_titles(self) -> List[str]:
        """Get list of music titles."""
        return [item['title'] for item in self.music_list]
    
    def get_music_by_title(self, title: str) -> Optional[Dict[str, str]]:
        """
        Get music item by title.
        
        Args:
            title: Music title to search for
            
        Returns:
            Music item dict or None if not found
        """
        for item in self.music_list:
            if item['title'].lower() == title.lower():
                return item
        
        # Try partial match
        for item in self.music_list:
            if title.lower() in item['title'].lower():
                return item
        
        return None
    
    def play_music(self, music_item: Dict[str, str]) -> bool:
        """
        Play a music item.
        
        Args:
            music_item: Music item dictionary
            
        Returns:
            True if successfully started playback, False otherwise
        """
        try:
            if music_item['source'] == 'local':
                if not PYGAME_AVAILABLE:
                    print(f"❌ Cannot play music: pygame not installed")
                    print(f"   File: {music_item['path']}")
                    print(f"   Install with: pip install pygame")
                    return False
                
                # Stop current music if playing
                if self.is_playing:
                    pygame.mixer.music.stop()
                
                # Load and play the music file
                print(f"▶️  Playing: {music_item['title']}")
                print(f"   Path: {music_item['path']}")
                
                pygame.mixer.music.load(music_item['path'])
                pygame.mixer.music.play()
                self.is_playing = True
                
                print(f"🔊 Music is now playing! Volume: {pygame.mixer.music.get_volume() * 100:.0f}%")
                return True
                
            elif music_item['source'] == 'youtube':
                # For YouTube, open in browser
                url = f"https://www.youtube.com/watch?v={music_item['id']}"
                print(f"▶️  Opening YouTube: {music_item['title']}")
                print(f"   URL: {url}")
                webbrowser.open(url)
                return True
            
        except Exception as e:
            print(f"❌ Error playing music: {e}")
            return False
        
        return False
    
    def stop_music(self) -> bool:
        """
        Stop currently playing music.
        
        Returns:
            True if successfully stopped, False otherwise
        """
        try:
            if PYGAME_AVAILABLE and self.is_playing:
                pygame.mixer.music.stop()
                self.is_playing = False
                print("⏹️  Music stopped")
                return True
        except Exception as e:
            print(f"Error stopping music: {e}")
            return False
        return False
    
    def set_volume(self, volume: float) -> bool:
        """
        Set playback volume.
        
        Args:
            volume: Volume level (0.0 to 1.0)
            
        Returns:
            True if successfully set, False otherwise
        """
        try:
            if PYGAME_AVAILABLE:
                volume = max(0.0, min(1.0, volume))  # Clamp between 0 and 1
                pygame.mixer.music.set_volume(volume)
                print(f"🔊 Volume set to {volume * 100:.0f}%")
                return True
        except Exception as e:
            print(f"Error setting volume: {e}")
            return False
        return False
