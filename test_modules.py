"""
Simple test script to verify module imports and basic functionality.
"""

import sys


def test_imports():
    """Test that all modules can be imported."""
    print("Testing module imports...")
    
    try:
        print("  - Testing music_manager...")
        from music_manager import MusicManager
        print("    ✅ music_manager imported successfully")
    except Exception as e:
        print(f"    ❌ Failed to import music_manager: {e}")
        return False
    
    try:
        print("  - Testing llm_client...")
        from llm_client import LLMClient
        print("    ✅ llm_client imported successfully")
    except Exception as e:
        print(f"    ❌ Failed to import llm_client: {e}")
        return False
    
    # Audio and transcription might fail without dependencies
    try:
        print("  - Testing audio_capture...")
        from audio_capture import AudioCapture
        print("    ✅ audio_capture imported successfully")
    except Exception as e:
        print(f"    ⚠️  audio_capture import failed (expected without PyAudio): {e}")
    
    try:
        print("  - Testing transcription...")
        from transcription import Transcriber
        print("    ✅ transcription imported successfully")
    except Exception as e:
        print(f"    ⚠️  transcription import failed (expected without SpeechRecognition): {e}")
    
    return True


def test_music_manager():
    """Test MusicManager with a mock local folder."""
    print("\nTesting MusicManager...")
    
    try:
        from music_manager import MusicManager
        
        # Test with non-existent folder (should handle gracefully)
        manager = MusicManager(local_folder="/tmp/test_music")
        music_list = manager.load_music_list()
        print(f"  ✅ MusicManager created and loaded (found {len(music_list)} tracks)")
        
        titles = manager.get_music_titles()
        print(f"  ✅ Got {len(titles)} music titles")
        
        return True
    except Exception as e:
        print(f"  ❌ MusicManager test failed: {e}")
        return False


def test_llm_client_parsing():
    """Test LLM client response parsing."""
    print("\nTesting LLMClient response parsing...")
    
    try:
        from llm_client import LLMClient
        
        # We can't test actual LLM calls without API keys, but we can test parsing
        client = LLMClient(provider="openai", api_key="dummy", model="gpt-3.5-turbo")
        
        # Test parsing logic with mock response
        mock_response = """
TITLE: Epic Battle Theme
SCORE: 0.9
REASON: High intensity action scene

TITLE: Peaceful Ambient
SCORE: 0.3
REASON: Doesn't match the mood
"""
        music_list = ["Epic Battle Theme", "Peaceful Ambient", "Dark Dungeon"]
        rankings = client._parse_rankings(mock_response, music_list)
        
        print(f"  ✅ Parsed {len(rankings)} rankings")
        if rankings:
            print(f"  ✅ Top match: {rankings[0]['title']} (score: {rankings[0]['score']})")
        
        return True
    except Exception as e:
        print(f"  ❌ LLMClient test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Run all tests."""
    print("=" * 60)
    print("Doty - Music Recommendation System - Module Tests")
    print("=" * 60)
    
    results = []
    
    results.append(("Imports", test_imports()))
    results.append(("MusicManager", test_music_manager()))
    results.append(("LLMClient Parsing", test_llm_client_parsing()))
    
    print("\n" + "=" * 60)
    print("Test Summary:")
    print("=" * 60)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{test_name}: {status}")
    
    all_passed = all(result for _, result in results)
    
    if all_passed:
        print("\n✅ All tests passed!")
        return 0
    else:
        print("\n⚠️  Some tests failed (may be due to missing dependencies)")
        return 1


if __name__ == '__main__':
    sys.exit(main())
