"""
Demo script to showcase the music recommendation system without audio hardware.
This simulates the workflow with example transcripts.
"""

import sys
from llm_client import LLMClient
from music_manager import MusicManager


def demo_music_ranking():
    """Demonstrate music ranking with example transcripts."""
    print("=" * 70)
    print("Doty - Music Recommendation System - Demo")
    print("=" * 70)
    
    # Create example music library
    example_music = [
        "Epic Battle Theme - Dark Souls",
        "Peaceful Village Ambience",
        "Mysterious Cave Exploration",
        "Tavern Music - Medieval",
        "Boss Fight - Intense Orchestra",
        "Sad Piano Melody",
        "Upbeat Adventure Theme",
        "Spooky Dungeon Atmosphere",
        "Celebratory Victory Fanfare",
        "Calm Forest Sounds"
    ]
    
    # Example scenarios
    scenarios = [
        {
            "name": "D&D Combat Scene",
            "transcript": "Roll for initiative! The dragon roars and spreads its massive wings. Everyone prepare for battle!",
            "context": "Epic combat encounter"
        },
        {
            "name": "Peaceful Village Scene",
            "transcript": "You arrive at a small village. Children are playing in the square, and you can smell fresh bread from the bakery.",
            "context": "Relaxing exploration"
        },
        {
            "name": "Mysterious Discovery",
            "transcript": "As you enter the ancient tomb, you notice strange symbols glowing on the walls. Something feels very wrong here.",
            "context": "Suspenseful exploration"
        },
        {
            "name": "Tavern Social",
            "transcript": "The party gathers around the table, sharing stories and ale. Laughter fills the warm tavern.",
            "context": "Social roleplay"
        }
    ]
    
    print("\n📚 Example Music Library:")
    print("-" * 70)
    for i, music in enumerate(example_music, 1):
        print(f"  {i}. {music}")
    
    print("\n\n🎭 Testing Different Scenarios:")
    print("=" * 70)
    
    # Note: This demo would require a valid API key to actually run
    # We'll show the structure instead
    
    for scenario in scenarios:
        print(f"\n🎬 Scenario: {scenario['name']}")
        print(f"📝 Transcript: \"{scenario['transcript']}\"")
        print(f"🎯 Context: {scenario['context']}")
        print("\n💭 Expected Recommendations (with actual LLM):")
        print("   [Would rank music based on mood, intensity, and theme]")
        print("   [Top matches would be displayed with confidence scores]")
        print("-" * 70)
    
    print("\n\n💡 How to use with actual LLM:")
    print("=" * 70)
    print("1. Set up config.yaml with your OpenAI API key or Ollama endpoint")
    print("2. Uncomment the code below to see actual LLM recommendations")
    print("3. Run: python demo.py")
    print("\n" + "=" * 70)
    
    # Demonstration of LLM integration (requires API key)
    print("\n\n🔧 LLM Integration Test:")
    print("=" * 70)
    try:
        # This will fail without a valid API key, which is expected
        client = LLMClient(
            provider="openai",
            api_key="demo-key-not-valid",
            model="gpt-3.5-turbo"
        )
        print("✅ LLMClient initialized (API calls would require valid credentials)")
        print("✅ Supports both OpenAI and Ollama endpoints")
        print("✅ Configurable via config.yaml")
    except Exception as e:
        print(f"⚠️  Note: {e}")
    
    print("\n\n📖 Usage Examples:")
    print("=" * 70)
    print("\n1. Copilot Mode (Show recommendations):")
    print("   $ python main.py --mode copilot")
    print("   - Listens to conversation")
    print("   - Shows top 5 music recommendations")
    print("   - User selects which to play")
    
    print("\n2. Auto Mode (Automatic selection):")
    print("   $ python main.py --mode auto")
    print("   - Listens to conversation")
    print("   - Automatically plays best match")
    print("   - Switches music as conversation changes")
    
    print("\n3. List Audio Devices:")
    print("   $ python main.py --list-devices")
    
    print("\n\n🎵 Music Source Configuration:")
    print("=" * 70)
    print("Local Folder Example:")
    print("  music:")
    print("    local_folder: '/Users/username/Music/D&D'")
    print("\nYouTube Playlist Example:")
    print("  music:")
    print("    youtube_playlist: 'https://www.youtube.com/playlist?list=PLxxxxxx'")
    
    print("\n\n✅ Demo Complete!")
    print("=" * 70)
    print("To run the actual application:")
    print("1. Install all dependencies: pip install -r requirements.txt")
    print("2. Configure config.yaml with your settings")
    print("3. Run: python main.py")
    print("=" * 70)


if __name__ == '__main__':
    demo_music_ranking()
