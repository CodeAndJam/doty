#!/bin/bash
# Quick setup using conda (works perfectly on macOS)
set -e

echo "Creating conda environment for doty STT..."
echo ""

if ! command -v conda &> /dev/null; then
    echo "❌ conda not found. Install from: https://docs.conda.io/projects/conda/en/latest/user-guide/install/macos.html"
    exit 1
fi

# Create environment
echo "📦 Creating Python 3.11 environment..."
conda create -n doty-stt python=3.11 -y

# Activate and install
echo "📥 Installing packages..."
conda run -n doty-stt conda install -c conda-forge \
    parakeet-mlx \
    mlx \
    soundfile \
    pyaudio \
    numpy \
    loguru \
    -y

echo ""
echo "✓ Setup complete!"
echo ""
echo "To use STT, run:"
echo "  conda activate doty-stt"
echo "  python stt_parakeet.py"
echo ""
echo "Or in one command:"
echo "  conda run -n doty-stt python stt_parakeet.py"
