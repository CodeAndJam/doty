#!/bin/bash
# Wrapper script to run STT with proper library paths on macOS
set -e

export DYLD_LIBRARY_PATH="/opt/homebrew/opt/zlib/lib:$DYLD_LIBRARY_PATH"

cd "$(dirname "$0")" 
exec uv run stt_parakeet.py "$@"
