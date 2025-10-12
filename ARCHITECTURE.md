# Project Architecture

## Overview

Doty is a modular Python application that uses speech recognition and AI to recommend music based on conversation context. It's designed primarily for macOS but supports other platforms.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         User                                 │
│                      (Speaking)                              │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                   AudioCapture                               │
│  • Captures microphone input                                 │
│  • Streams audio in chunks                                   │
│  • Supports multiple devices                                 │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                   Transcriber                                │
│  • Converts speech to text                                   │
│  • Uses Google Speech Recognition                            │
│  • Detects speech presence                                   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                   LLMClient                                  │
│  • Analyzes conversation context                             │
│  • Ranks music based on mood/theme                           │
│  • Supports OpenAI & Ollama                                  │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                   MusicManager                               │
│  • Manages music sources                                     │
│  • Loads from local folder or YouTube                        │
│  • Handles playback (output)                                 │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                 Main Application                             │
│  • Coordinates all components                                │
│  • Handles user modes (Copilot/Auto)                         │
│  • Manages configuration                                     │
└─────────────────────────────────────────────────────────────┘
```

## Module Details

### 1. audio_capture.py

**Purpose:** Capture audio from microphone(s)

**Key Classes:**
- `AudioCapture`: Main audio capture class

**Features:**
- Multi-device support
- Configurable sample rate
- Threaded audio capture
- Callback-based audio delivery
- Device enumeration

**Dependencies:**
- PyAudio
- Threading
- NumPy

### 2. transcription.py

**Purpose:** Convert speech to text

**Key Classes:**
- `Transcriber`: Speech-to-text handler

**Features:**
- Google Speech Recognition
- Configurable language
- Energy threshold detection
- In-memory audio processing

**Dependencies:**
- SpeechRecognition
- Wave (audio processing)

### 3. llm_client.py

**Purpose:** AI-powered music ranking

**Key Classes:**
- `LLMClient`: Interface to LLM providers

**Features:**
- OpenAI API support
- Ollama local LLM support
- Context-aware prompting
- Response parsing
- Confidence scoring

**Dependencies:**
- OpenAI Python SDK
- Requests

### 4. music_manager.py

**Purpose:** Manage music sources and playback

**Key Classes:**
- `MusicManager`: Music library handler

**Features:**
- Local folder scanning
- YouTube playlist extraction
- Music metadata management
- Title-based search
- Multiple format support (MP3, WAV, FLAC, OGG, M4A, AAC)

**Dependencies:**
- yt-dlp (YouTube)
- PathLib
- OS

### 5. main.py

**Purpose:** Main application orchestration

**Key Classes:**
- `MusicRecommendationApp`: Main application controller

**Features:**
- Configuration management
- Mode selection (Copilot/Auto)
- Component coordination
- User interface
- Command-line interface

**Dependencies:**
- All above modules
- YAML (configuration)
- Argparse (CLI)

## Data Flow

### Copilot Mode Flow

```
1. Audio captured from microphone
   ↓
2. Audio transcribed to text
   ↓
3. Text sent to LLM for analysis
   ↓
4. LLM returns ranked music list with reasons
   ↓
5. Display recommendations to user
   ↓
6. User selects music to play
   ↓
7. MusicManager plays selected music
```

### Auto Mode Flow

```
1. Audio captured from microphone
   ↓
2. Audio transcribed to text
   ↓
3. Text sent to LLM for analysis
   ↓
4. LLM returns ranked music list
   ↓
5. Automatically select top match
   ↓
6. MusicManager plays selected music
   ↓
7. Wait for configured delay
   ↓
8. Return to step 1
```

## Configuration System

### Configuration File (config.yaml)

```yaml
llm:           # LLM provider settings
  provider:    # "openai" or "ollama"
  api_key:     # API key (if needed)
  base_url:    # API endpoint
  model:       # Model name

audio:         # Audio capture settings
  sample_rate: # Sample rate in Hz
  chunk_duration: # Seconds per chunk
  device_index: # Device to use (optional)

music:         # Music source settings
  local_folder: # Path to music folder
  youtube_playlist: # YouTube playlist URL

mode:          # Mode configuration
  default:     # "copilot" or "auto"
  auto_switch_delay: # Seconds in auto mode

transcription: # Transcription settings
  language:    # Language code
  energy_threshold: # Voice detection threshold
```

## Extension Points

### Adding New LLM Providers

To add a new LLM provider:

1. Edit `llm_client.py`
2. Add provider initialization in `__init__`
3. Ensure compatibility with OpenAI API format
4. Update configuration documentation

### Adding New Music Sources

To add a new music source:

1. Edit `music_manager.py`
2. Add new loading method (e.g., `_load_spotify_playlist`)
3. Update `load_music_list` to call new method
4. Add configuration options

### Custom Transcription Engines

To use a different transcription engine:

1. Edit `transcription.py`
2. Replace Google Speech Recognition with your engine
3. Maintain the same interface (`transcribe` method)

## Testing Strategy

### Unit Tests (`test_modules.py`)
- Tests individual module imports
- Tests basic functionality of each class
- Mocks external dependencies

### Integration Tests (`test_integration.py`)
- Tests complete workflow
- Tests with mock data
- Validates module interaction

### Demo (`demo.py`)
- Demonstrates usage scenarios
- Shows expected behavior
- Provides examples for documentation

## Performance Considerations

### Audio Capture
- Uses threading to avoid blocking
- Configurable chunk size for latency vs. accuracy
- Handles buffer overflow gracefully

### Transcription
- In-memory processing (no file I/O)
- Energy threshold to avoid processing silence
- Async-capable design

### LLM Calls
- Rate limiting considerations
- Caching could be added for repeated contexts
- Configurable model selection for cost/quality tradeoff

### Music Loading
- YouTube: Extract-flat mode (no downloading)
- Local: One-time scan at startup
- Lazy loading possible for large libraries

## Security Considerations

### API Keys
- Stored in config.yaml (not committed)
- Environment variable support possible
- Never logged or displayed

### Audio Privacy
- Audio processed in memory
- No recording by default
- User-controlled capture

### Network Security
- HTTPS for OpenAI API
- Local-only option (Ollama)
- No data sent without user consent

## Deployment Scenarios

### Local Development
- Default configuration
- Testing with demo data
- Debug mode available

### Production D&D Game
- Optimized energy threshold
- Local music library
- Ollama for privacy

### Streaming/Content Creation
- YouTube playlist integration
- OpenAI for quality
- Auto mode for convenience

## Future Enhancements

### Planned Features
- [ ] Music playback control (play/pause/skip)
- [ ] Multiple LLM provider fallback
- [ ] Web UI interface
- [ ] Spotify integration
- [ ] Custom prompt templates
- [ ] Music history tracking
- [ ] Context memory across sessions
- [ ] Multi-language support
- [ ] Voice command integration
- [ ] Discord bot integration

### Technical Debt
- [ ] Add comprehensive logging
- [ ] Add unit test coverage
- [ ] Improve error handling
- [ ] Add retry logic for API calls
- [ ] Optimize memory usage
- [ ] Add performance metrics

## Dependencies

### Core Dependencies
- Python 3.8+
- PyAudio (audio capture)
- SpeechRecognition (transcription)
- OpenAI SDK (LLM)
- yt-dlp (YouTube)
- PyYAML (configuration)

### Platform-Specific
- macOS: PortAudio (via Homebrew)
- Linux: PortAudio development files
- Windows: PyAudio binary wheels

### Optional Dependencies
- Ollama (local LLM option)
- ffmpeg (for audio format conversion)

## Troubleshooting

### Common Issues

**PyAudio Installation Fails:**
- Solution: Install PortAudio first (`brew install portaudio`)

**No Audio Detected:**
- Check microphone permissions
- Verify device index
- Adjust energy threshold

**LLM API Errors:**
- Verify API key
- Check internet connection
- Validate model name

**No Music Found:**
- Check folder path
- Verify file extensions
- Test YouTube playlist URL

## License

This project is open source under the MIT License.
