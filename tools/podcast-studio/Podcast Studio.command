#!/bin/bash
# Double-click to start Podcast Studio (opens in your browser). Close this window to stop it.
cd "$(dirname "$0")" || exit 1
exec python3 app/studio.py
