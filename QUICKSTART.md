# Quick Start Guide

## Installation

### 1. Prerequisites

**For macOS (recommended platform):**
```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install PortAudio (required for PyAudio)
brew install portaudio

# Install Python 3.8+
brew install python3
```

**For Linux:**
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install python3 python3-pip portaudio19-dev

# Fedora
sudo dnf install python3 python3-pip portaudio-devel
```

### 2. Install Python Dependencies

```bash
# Clone the repository
git clone https://github.com/CodeAndJam/doty.git
cd doty

# Install required packages
pip install -r requirements.txt
```

### 3. Configure the Application

```bash
# Copy the example configuration
cp config.example.yaml config.yaml

# Edit with your preferred editor
nano config.yaml  # or vim, code, etc.
```

**Required Configuration:**

At minimum, you need to configure:

1. **LLM Provider** (choose one):
   
   **Option A: OpenAI**
   ```yaml
   llm:
     provider: "openai"
     api_key: "sk-your-api-key-here"
     base_url: "https://api.openai.com/v1"
     model: "gpt-3.5-turbo"
   ```

   **Option B: Ollama (Local)**
   ```bash
   # Install Ollama first
   curl https://ollama.ai/install.sh | sh
   
   # Pull a model
   ollama pull llama2
   
   # Start Ollama service
   ollama serve
   ```
   
   Then in config.yaml:
   ```yaml
   llm:
     provider: "ollama"
     base_url: "http://localhost:11434/v1"
     model: "llama2"
     api_key: "not-needed"
   ```

2. **Music Source** (at least one):

   **Option A: Local Folder**
   ```yaml
   music:
     local_folder: "/Users/yourname/Music/D&D"
   ```

   **Option B: YouTube Playlist**
   ```yaml
   music:
     youtube_playlist: "https://www.youtube.com/playlist?list=PLxxxxxx"
   ```

## Usage

### Quick Test

1. **List available microphones:**
   ```bash
   python main.py --list-devices
   ```

2. **Run in Copilot Mode (recommended for first time):**
   ```bash
   python main.py --mode copilot
   ```

3. **Run in Auto Mode:**
   ```bash
   python main.py --mode auto
   ```

### Mode Descriptions

**Copilot Mode:**
- Listens to conversation continuously
- Analyzes speech every 5 seconds (configurable)
- Shows top 5 music recommendations with confidence scores
- Waits for user to select which music to play
- Best for: Interactive sessions, D&D games, manual control

**Auto Mode:**
- Listens to conversation continuously
- Automatically selects and plays the best matching music
- Switches music as conversation context changes
- Best for: Automated scenarios, background ambiance

## Example Workflow

### D&D Session Example

1. **Start the application:**
   ```bash
   python main.py --mode copilot
   ```

2. **The system will:**
   - Start listening through your microphone
   - Capture audio every 5 seconds
   - Transcribe what's being said
   - Analyze the conversation context

3. **When it detects speech:**
   ```
   🎤 Detected: "The party enters a dark dungeon. You hear strange noises."
   
   🤔 Analyzing conversation with 50 available tracks...
   
   🎵 Music Recommendations:
   ============================================================
   
   1. Spooky Dungeon Atmosphere
      Confidence: 95.0%
      Reason: Dark setting with mysterious elements, perfect for dungeon exploration
   
   2. Mysterious Cave Exploration
      Confidence: 85.0%
      Reason: Underground setting matches the dungeon theme
   
   3. Dark Ambient Sounds
      Confidence: 75.0%
      Reason: Creates appropriate suspenseful atmosphere
   
   ...
   ```

4. **Select music to play:**
   ```
   Enter the number to play (1-5), or 's' to skip: 1
   ```

## Testing

Run the test suite to verify installation:

```bash
# Test core modules
python test_modules.py

# Test integration
python test_integration.py

# Run demo
python demo.py
```

## Troubleshooting

### PyAudio Installation Issues (macOS)

If you get PyAudio errors:
```bash
# Ensure PortAudio is installed
brew install portaudio

# Reinstall PyAudio
pip uninstall pyaudio
pip install --upgrade pyaudio
```

### Microphone Permission Denied (macOS)

1. Go to System Preferences → Security & Privacy → Privacy → Microphone
2. Enable Terminal (or your terminal app)
3. Restart the application

### No Music Found

Check your configuration:
```bash
# Verify local folder exists
ls -la /path/to/your/music

# Test YouTube playlist URL in browser
```

### LLM Connection Issues

**OpenAI:**
- Verify API key is valid
- Check internet connection
- Test with: `curl https://api.openai.com/v1/models -H "Authorization: Bearer YOUR_KEY"`

**Ollama:**
- Ensure Ollama is running: `ollama serve`
- Test with: `curl http://localhost:11434/api/tags`

## Advanced Configuration

### Custom Audio Device

If you have multiple microphones:
```bash
# List devices
python main.py --list-devices

# Note the device index (e.g., 2)
# Edit config.yaml:
audio:
  device_index: 2
```

### Adjust Sensitivity

If the system is too sensitive or not sensitive enough:
```yaml
transcription:
  energy_threshold: 4000  # Increase for less sensitivity, decrease for more
```

### Change Analysis Frequency

```yaml
audio:
  chunk_duration: 5  # Seconds between analysis (increase to reduce API calls)
```

## Tips for Best Results

1. **Speak Clearly:** The system works best with clear speech
2. **Minimize Background Noise:** Use in a relatively quiet environment
3. **Descriptive Language:** Use descriptive words (e.g., "spooky," "exciting," "peaceful")
4. **Music Organization:** Organize music with descriptive titles for better matching
5. **Copilot Mode First:** Start with Copilot mode to understand how the system works

## Next Steps

- Organize your music library with descriptive titles
- Create YouTube playlists for different moods/themes
- Experiment with both Copilot and Auto modes
- Fine-tune configuration settings for your use case
- Consider using both local and YouTube sources for variety

For more information, see the main [README.md](README.md)
