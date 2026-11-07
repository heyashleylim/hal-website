#!/bin/bash
# Builds the shareable Podcast-Studio.zip (only the Studio, nothing from the website) into ~/Downloads.
# Source: tools/podcast-studio/. Usage: bash tools/build-podcast-studio-zip.sh [output.zip]
set -e
SRC="$(cd "$(dirname "$0")/podcast-studio" && pwd)"
OUT="${1:-$HOME/Downloads/Podcast-Studio.zip}"
STAGE="$(mktemp -d)"
mkdir "$STAGE/Podcast-Studio"
rsync -a --exclude '__pycache__' --exclude '.DS_Store' "$SRC/" "$STAGE/Podcast-Studio/"
chmod +x "$STAGE/Podcast-Studio/podcast-studio" "$STAGE/Podcast-Studio/setup.sh" "$STAGE/Podcast-Studio/Podcast Studio.command"
rm -f "$OUT"
ditto -c -k --norsrc --noextattr --noacl --keepParent "$STAGE/Podcast-Studio" "$OUT"
rm -rf "$STAGE"
echo "$OUT ($(du -h "$OUT" | cut -f1))"
