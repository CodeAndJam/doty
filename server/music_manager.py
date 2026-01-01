import os
import glob
from typing import List
from loguru import logger

class MusicManager:
    """
    Manages scanning local directories for music and tracking available files.
    """
    SUPPORTED_EXTENSIONS = [".mp3", ".wav", ".m4a", ".flac"]

    def __init__(self, base_dir: str):
        self.base_dir = base_dir
        self.tracks = []
        self.refresh_tracks()

    def refresh_tracks(self, new_dir: str = None):
        if new_dir:
            self.base_dir = new_dir
        
        self.tracks = []
        if not os.path.exists(self.base_dir):
            logger.warning(f"Music directory {self.base_dir} does not exist.")
            return

        for ext in self.SUPPORTED_EXTENSIONS:
            # Recursive search
            pattern = os.path.join(self.base_dir, "**", f"*{ext}")
            self.tracks.extend(glob.glob(pattern, recursive=True))
        
        logger.info(f"Found {len(self.tracks)} tracks in {self.base_dir}")

    def get_track_list(self) -> List[str]:
        return [os.path.basename(p) for p in self.tracks]

    def get_full_path(self, track_name: str) -> str:
        for p in self.tracks:
            if os.path.basename(p) == track_name:
                return p
        return None
