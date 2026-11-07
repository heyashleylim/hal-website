# Podcast Studio — instructions for Claude Code

This folder is **Podcast Studio**: a local app (Python server + browser page at http://127.0.0.1:8792) that
prepares podcast episodes. The user adds audio files; the Studio transcribes them in Korean with Whisper on
this Mac; **you suggest chapters** from the transcript; the user checks them while listening; the Studio exports
**mono MP3 · 96 kbps · −16 LUFS · true peak ≤ −1 dB · ID3 chapters** to `~/Downloads/Podcast Studio`.
Nothing leaves the Mac, and no API key or account is involved: the AI part is you, in this session.

The user is not technical. Do the work yourself, keep explanations short, and never ask them to edit files.
All commands below run from this folder (the one containing this file).

## Install / set up ("set it up", "install Podcast Studio")

If the user gave you a zip (e.g. `~/Downloads/Podcast-Studio.zip`) and this folder doesn't exist yet: unzip it
into their home folder (`ditto -x -k <zip> ~`), giving `~/Podcast-Studio`, then continue from there. If
`~/Podcast-Studio` already exists, ask before replacing it (their work is not stored there, but ask anyway).

1. Run `bash setup.sh --check`.
2. If anything is missing, run `bash setup.sh` in the background (it installs Python 3, ffmpeg and
   whisper-cpp with Homebrew and downloads the Whisper model, ~550 MB). Tell the user it takes a few minutes.
   - Exit code `2` = Homebrew is missing. Don't install it yourself: it needs the user's Mac password.
     Tell them to open the Terminal app, paste the one-line install command shown on https://brew.sh,
     follow its prompts, then come back and say "continue the setup".
   - "Not enough free disk space": tell them how much is free (`df -h ~`); ~1.5 GB is needed.
   - A failed download: run `bash setup.sh` again (it resumes).
3. When it prints "Ready", tell the user it's installed and offer to open it.

## Open ("open Podcast Studio")

1. If `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8792/` prints 200, it's already running.
2. Otherwise run `./podcast-studio start` **in the background** (it opens the browser). Wait for its output
   to show the address.
3. Tell the user: "Podcast Studio is open in your browser (http://127.0.0.1:8792). Drop your audio files on
   the page; I'll suggest chapters once they're transcribed."
The Studio keeps running while this Claude Code session is open.

## Suggest chapters ("suggest chapters for …")

1. `./podcast-studio list` shows the files. Each needs `transcript=done` (Whisper does one file at a time,
   a few minutes per hour of audio). If some are still running, say so and check again in a minute with
   `list` (don't loop rapidly).
2. For each file the user means (or all of them): `./podcast-studio transcript "<part of the file name>"`,
   and read the whole output (duration, long pauses, transcript lines with `[seconds]`).
3. Choose chapters:
   - A new chapter where the topic or section changes: introduction, each main idea, exercises or homework,
     closing. Usually one every 3–8 minutes; a 60-minute module typically has 6–12. Don't split arbitrarily.
   - The first chapter starts at 0. Every other start is the `[seconds]` of the transcript line where that part
     begins (prefer a line right after one of the long pauses when it fits).
   - Titles: short (about 8–25 characters), in the episode's language (Korean here), saying what the part is
     about ("신경계가 먼저인 이유", "이번 주 과제"), not its first words. No numbers, emoji or quotes.
4. Save them: write `[{"start": 0, "title": "…"}, {"start": 312.4, "title": "…"}]` to a temporary JSON file
   and run `./podcast-studio set-chapters "<file>" <json file>`. The open page updates by itself.
5. Tell the user the chapters (time + title) and that they can click ▶ next to each one in the page to
   listen, adjust times or titles, then export.
If the user already edited a file's chapters by hand (chapters exist and they didn't ask for new ones),
ask before replacing them.

## Export

Normally the user ticks files in the page and clicks "Export selected". If they ask you:
`./podcast-studio export "<file>"` or `./podcast-studio export --all`. Report the size, loudness, peak and
chapter count it prints. Files go to `~/Downloads/Podcast Studio`; they upload those on the podcast admin's
Episodes page.

## Reference

- `./podcast-studio status`: which requirements are present.
- `./podcast-studio start --port 8793`: if port 8792 is taken by something else.
- Work files (copies of the audio, transcripts, chapters): `~/.cache/podcast-studio/projects`; ✕ on a file in
  the page deletes its work folder. The Whisper model is in `~/.cache/podcast-studio/models`. Exports are never
  deleted by the Studio.
- Code: `app/studio.py` (server + commands), `app/encode.py` (the export, ffmpeg two-pass loudness),
  `app/ui/` (the page), `setup.sh`, `Podcast Studio.command` (double-click launcher).
