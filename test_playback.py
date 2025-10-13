"""
Simple test script to verify audio playback functionality.
"""

import time
from music_manager import MusicManager

def test_playback():
    """Test audio playback with local music files."""
    
    print("🎵 Testing Audio Playback\n")
    print("=" * 60)
    
    # Initialize music manager with local folder
    manager = MusicManager(local_folder="music")
    
    # Load music list
    print("\n📚 Loading music library...")
    music_list = manager.load_music_list()
    
    if not music_list:
        print("❌ No music found in the music folder")
        return
    
    print(f"✅ Found {len(music_list)} tracks\n")
    
    # Display available tracks
    print("Available tracks:")
    for i, track in enumerate(music_list, 1):
        print(f"  {i}. {track['title']}")
    
    # Play the first track
    if music_list:
        print(f"\n▶️  Testing playback with: {music_list[0]['title']}")
        print("=" * 60)
        
        success = manager.play_music(music_list[0])
        
        if success:
            print("\n✅ Playback started successfully!")
            print("\nThe music should be playing now.")
            print("If you can hear the music, the fix is working! 🎉")
            print("\nLet it play for a few seconds...")
            
            # Let it play for 10 seconds
            for i in range(10, 0, -1):
                print(f"\rStopping in {i} seconds...", end='', flush=True)
                time.sleep(1)
            
            print("\n\n⏹️  Stopping playback...")
            manager.stop_music()
            print("\n✅ Test complete!")
        else:
            print("\n❌ Playback failed. Check the error messages above.")
    
    print("\n" + "=" * 60)

if __name__ == "__main__":
    test_playback()
