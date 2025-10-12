# Doty - AI-Powered Music Recommendation System

An intelligent music recommendation system that listens to conversations and suggests appropriate music based on the mood, theme, and atmosphere. Perfect for DMs (Dungeon Masters), content creators, or anyone who wants music that matches the moment.

## Features

- 🎤 **Real-time Audio Capture**: Captures audio from all available microphones (optimized for macOS)
- 🗣️ **Speech-to-Text**: Automatically transcribes conversations using Google Speech Recognition
- 🤖 **AI-Powered Recommendations**: Uses LLMs (OpenAI or Ollama) to analyze context and recommend music
- 🎵 **Multiple Music Sources**: Supports local music folders and YouTube playlists
- 🎮 **Two Operating Modes**:
  - **Copilot Mode**: Shows recommendations for manual selection
  - **Auto Mode**: Automatically switches music based on conversation

## Requirements

- Python 3.8+
- OpenAI API key (for OpenAI) or Ollama installation (for local LLM)
- Internet connection for speech recognition and YouTube playlists
- Microphone access

## Installation

1. Clone the repository:
```bash
git clone https://github.com/CodeAndJam/doty.git
cd doty
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. For macOS users (required for PyAudio):
```bash
brew install portaudio
pip install --upgrade pyaudio
```

4. Copy and configure the example config:
```bash
cp config.example.yaml config.yaml
```

5. Edit `config.yaml` with your settings:
```yaml
llm:
  provider: "openai"  # or "ollama"
  api_key: "your-openai-api-key"
  model: "gpt-3.5-turbo"

music:
  local_folder: "/path/to/your/music"
  youtube_playlist: "https://www.youtube.com/playlist?list=YOUR_PLAYLIST_ID"
```

## Usage

### Basic Usage

Run in copilot mode (default):
```bash
python main.py
```

Run in auto mode:
```bash
python main.py --mode auto
```

### Command Line Options

```bash
python main.py --help
```

Options:
- `--mode {copilot,auto}`: Choose operating mode
- `--config CONFIG`: Path to configuration file (default: config.yaml)
- `--list-devices`: List available audio input devices

### Configuration

Edit `config.yaml` to customize:

#### LLM Configuration
```yaml
llm:
  provider: "openai"  # "openai" or "ollama"
  api_key: "sk-..."  # OpenAI API key
  base_url: "https://api.openai.com/v1"  # or "http://localhost:11434/v1" for Ollama
  model: "gpt-3.5-turbo"  # or "llama2" for Ollama
```

#### Audio Configuration
```yaml
audio:
  sample_rate: 16000  # Audio sample rate
  chunk_duration: 5  # Seconds to capture before processing
  device_index: null  # Specific device index or null for default
```

#### Music Sources
```yaml
music:
  local_folder: "/path/to/music"  # Path to local music folder
  youtube_playlist: "https://www.youtube.com/playlist?list=..."  # YouTube playlist URL
```

#### Mode Settings
```yaml
mode:
  default: "copilot"  # "copilot" or "auto"
  auto_switch_delay: 30  # Seconds between checks in auto mode
```

## How It Works

1. **Audio Capture**: Continuously captures audio from your microphone(s)
2. **Transcription**: Converts speech to text using Google Speech Recognition
3. **Context Analysis**: Sends the transcript to an LLM for analysis
4. **Music Ranking**: The LLM ranks available music based on mood, theme, and atmosphere
5. **Playback Control**: 
   - **Copilot Mode**: Displays top 5 recommendations with explanations for you to choose
   - **Auto Mode**: Automatically selects and plays the best match

## Using Ollama (Local LLM)

To use Ollama instead of OpenAI:

1. Install Ollama from [https://ollama.ai](https://ollama.ai)

2. Pull a model:
```bash
ollama pull llama2
```

3. Configure in `config.yaml`:
```yaml
llm:
  provider: "ollama"
  base_url: "http://localhost:11434/v1"
  model: "llama2"
  api_key: "not-needed"
```

## Examples

### Example 1: D&D Session
When running a D&D game, Doty listens to the conversation:
- Players enter a spooky dungeon → Recommends dark ambient music
- Combat begins → Recommends epic battle music
- Peaceful village scene → Recommends calm, folksy music

### Example 2: Content Creation
While recording a podcast or video:
- Discussing serious topic → Recommends thoughtful background music
- Funny moment → Recommends upbeat, light music
- Emotional story → Recommends touching, cinematic music

## Troubleshooting

### Audio Issues
- Run `python main.py --list-devices` to see available microphones
- Set `device_index` in config.yaml to use a specific device
- Check microphone permissions in System Preferences (macOS)

### LLM Issues
- Verify API key is correct (OpenAI)
- Ensure Ollama is running (for local LLM): `ollama serve`
- Check internet connection

### Music Issues
- Verify local folder path exists and contains audio files
- Test YouTube playlist URL in a browser
- Supported formats: MP3, WAV, FLAC, OGG, M4A, AAC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is open source and available under the MIT License.

## Acknowledgments

- Built with OpenAI API / Ollama for LLM capabilities
- Speech recognition powered by Google Speech Recognition
- YouTube support via yt-dlp
