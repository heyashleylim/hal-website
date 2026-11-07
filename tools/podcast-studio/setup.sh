#!/bin/bash
# Podcast Studio setup for macOS: checks and installs what the Studio needs. Safe to run again.
#   - Homebrew (must already be installed: it needs the user's password, so it is never installed here)
#   - Python 3, ffmpeg, whisper.cpp (whisper-cli)
#   - the Whisper model large-v3-turbo q5_0 (~550 MB) in ~/.cache/podcast-studio/models
# Usage: bash setup.sh          (installs what is missing)
#        bash setup.sh --check  (only reports)
set -u
CHECK_ONLY=0; [ "${1:-}" = "--check" ] && CHECK_ONLY=1
MODEL_DIR="$HOME/.cache/podcast-studio/models"
MODEL="$MODEL_DIR/ggml-large-v3-turbo-q5_0.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin"
MODEL_BYTES_MIN=500000000
missing=0
ok()   { printf '  ✓ %s\n' "$1"; }
todo() { printf '  ✗ %s\n' "$1"; missing=1; }

echo "Podcast Studio setup"
[ "$(uname -s)" = "Darwin" ] || { echo "This tool is for macOS."; exit 1; }

if command -v brew >/dev/null 2>&1; then ok "Homebrew"; else
  todo "Homebrew is missing. Install it from https://brew.sh (it asks for your Mac password), then run this again."
  exit 2
fi

if command -v python3 >/dev/null 2>&1; then ok "Python 3 ($(python3 --version 2>&1))"; else
  if [ $CHECK_ONLY -eq 1 ]; then todo "Python 3"; else echo "  … installing Python 3"; brew install python || exit 1; fi
fi

for pkg in ffmpeg whisper-cpp; do
  bin=$pkg; [ "$pkg" = "whisper-cpp" ] && bin=whisper-cli
  if command -v "$bin" >/dev/null 2>&1; then ok "$pkg"; else
    if [ $CHECK_ONLY -eq 1 ]; then todo "$pkg"; else echo "  … installing $pkg (Homebrew)"; brew install "$pkg" || exit 1; ok "$pkg"; fi
  fi
done

size=$( [ -f "$MODEL" ] && stat -f%z "$MODEL" || echo 0 )
if [ "$size" -ge $MODEL_BYTES_MIN ]; then ok "Whisper model ($(( size / 1048576 )) MB)"; else
  if [ $CHECK_ONLY -eq 1 ]; then todo "Whisper model ($MODEL)"; else
    free_kb=$(df -k "$HOME" | awk 'NR==2 {print $4}')
    if [ "$free_kb" -lt 1500000 ]; then echo "  ✗ Not enough free disk space for the model (need ~1.5 GB free)."; exit 1; fi
    mkdir -p "$MODEL_DIR"
    echo "  … downloading the Whisper model (~550 MB, resumable)"
    curl -L --fail -C - -o "$MODEL.part" "$MODEL_URL" && mv "$MODEL.part" "$MODEL" || { echo "  ✗ Download failed; run this again to resume."; exit 1; }
    ok "Whisper model"
  fi
fi

if command -v claude >/dev/null 2>&1; then ok "Claude Code (for 'Suggest with Claude')"; else
  printf '  – Claude Code not found: everything works; chapters are then suggested from pauses only.\n'
fi

# Files downloaded from the internet are blocked by macOS until approved: approve this folder.
xattr -dr com.apple.quarantine "$(cd "$(dirname "$0")" && pwd)" 2>/dev/null
chmod +x "$(dirname "$0")/podcast-studio" "$(dirname "$0")/Podcast Studio.command" 2>/dev/null

if [ $missing -eq 0 ]; then echo "Ready. Start it with: ./podcast-studio start   (or double-click \"Podcast Studio.command\")"; else echo "Some items are missing (run without --check to install)."; exit 3; fi
