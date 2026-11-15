#!/usr/bin/env python3
"""
Prepares podcast episodes for upload: mono MP3 (128 kbps by default), as loud as a -16 LUFS stereo file (true
peak at most -1 dB, Apple's guideline), and chapters embedded in the file (read by Apple Podcasts, Pocket Casts, Overcast).

How the sound is treated (kept as close to the original as possible):
  1. Stereo is averaged to mono first (recordings and video exports carry the same voice on both sides).
  2. One fixed volume change brings it to -19 LUFS. A mono file plays on both speakers, so -19 LUFS mono sounds
     exactly as loud as -16 LUFS stereo (the reported loudness is that "as heard" value).
  3. A light limiter, oversampled 4x, only catches the rare peaks above -1.5 dB. Nothing else: no compression,
     no dynamic normalisation (ffmpeg's dynamic loudnorm made voices pump), and no clipping.

Used by Podcast Studio (app/studio.py) and usable on its own, on many files at once.
Needs ffmpeg (brew install ffmpeg). Any input ffmpeg reads works: MP3, WAV, M4A, or a video export
(MP4/MOV, e.g. from CapCut): only the audio is kept.

    python3 app/encode.py ~/Podcast/module-*.mp3
    python3 app/encode.py ~/Podcast/*.mp4 --bitrate 160 --out ~/Podcast/ready

Chapters (optional): next to each input, a text file with the same name and ".chapters.txt",
e.g. module-01.mp3 → module-01.chapters.txt, one chapter per line, start time then title:

    0:00 들어가며
    3:25 신경계가 먼저예요
    1:02:10 이번 주 과제

Output: <out>/<input name>.mp3 (default out folder: "ready" next to the inputs). Inputs are never changed.
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

TARGET_TP = -1.0          # dBTP, measured on the final MP3
MONO_I = -19.0            # LUFS for a mono file = -16 LUFS stereo as heard
AS_HEARD = 3.0            # dB added when reporting a mono file's loudness as heard (both speakers)
LIMIT_DB = -1.5           # limiter ceiling before encoding (the MP3 encoder adds a few tenths of a dB)
BITRATES = (96, 128, 160, 192)
DEFAULT_BITRATE = 128


class EncodeError(Exception):
    pass


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def duration_seconds(path):
    r = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', str(path)])
    try:
        return float(r.stdout.strip())
    except ValueError:
        raise EncodeError(f'Cannot read {Path(path).name}: {r.stderr.strip()[:300]}')


def parse_time(text):
    parts = [float(p) for p in text.split(':')]
    if not 1 <= len(parts) <= 3:
        raise ValueError(text)
    seconds = 0.0
    for p in parts:
        seconds = seconds * 60 + p
    return seconds


def read_chapters(path, total):
    """[(start_seconds, title)] from a .chapters.txt file, checked and sorted."""
    chapters = []
    for n, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        m = re.match(r'^(\d+(?::\d{1,2}){1,2}(?:\.\d+)?)\s+(.+)$', line)
        if not m:
            raise EncodeError(f'{path.name}, line {n}: expected "M:SS Title" or "H:MM:SS Title", got: {line}')
        start = parse_time(m.group(1))
        if start >= total:
            raise EncodeError(f'{path.name}, line {n}: {m.group(1)} is after the end of the audio ({total / 60:.1f} min)')
        chapters.append((start, m.group(2).strip()))
    return sorted(chapters)


def metadata_file(chapters, total, title):
    def esc(s):
        return re.sub(r'([=;#\\\n])', r'\\\1', s)
    lines = [';FFMETADATA1', f'title={esc(title)}']
    for i, (start, name) in enumerate(chapters):
        end = chapters[i + 1][0] if i + 1 < len(chapters) else total
        lines += ['[CHAPTER]', 'TIMEBASE=1/1000', f'START={int(round(start * 1000))}', f'END={int(round(end * 1000))}', f'title={esc(name)}']
    f = tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False, encoding='utf-8')
    f.write('\n'.join(lines) + '\n')
    f.close()
    return f.name


def _ffmpeg_with_progress(cmd, total, on_progress, lo, hi):
    """Runs ffmpeg with -progress on stdout, reporting lo..hi percent. Returns stderr text."""
    proc = subprocess.Popen(cmd[:1] + ['-progress', 'pipe:1', '-nostats'] + cmd[1:], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    for line in proc.stdout:
        if on_progress and line.startswith('out_time_us=') and total:
            try:
                done = int(line.split('=', 1)[1]) / 1e6
            except ValueError:
                continue
            on_progress(lo + (hi - lo) * min(1.0, done / total))
    err = proc.stderr.read()
    proc.wait()
    return proc.returncode, err


def audio_info(path):
    r = run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels,sample_rate',
             '-of', 'json', str(path)])
    streams = json.loads(r.stdout or '{}').get('streams') or []
    if not streams:
        raise EncodeError(f'No audio found in {Path(path).name}.')
    return int(streams[0].get('channels') or 1), int(streams[0].get('sample_rate') or 44100)


def to_mono(channels):
    """Filter that averages the channels into one (no level change when both sides carry the same voice)."""
    if channels == 1:
        return 'anull'
    if channels == 2:
        return 'pan=mono|c0=0.5*c0+0.5*c1'
    return 'aformat=channel_layouts=mono'


def measure(path, total=None, on_progress=None, lo=0, hi=0, mono_filter='anull'):
    """Loudness and true peak of the (mono) audio, via ffmpeg loudnorm's analysis. Returns ffmpeg's JSON fields."""
    cmd = ['ffmpeg', '-hide_banner', '-i', str(path), '-vn',
           '-af', f'{mono_filter},loudnorm=print_format=json', '-f', 'null', '-']
    code, err = _ffmpeg_with_progress(cmd, total, on_progress, lo, hi)
    m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', err)
    if code != 0 or not m:
        raise EncodeError(f'Loudness measurement failed for {Path(path).name}: {err[-500:]}')
    return json.loads(m.group(0))


def treatment(mono_filter, gain_db, rate, limit_db=LIMIT_DB):
    """mono → one volume change → oversampled peak limiter → back to the output sample rate."""
    return (f'{mono_filter},volume={gain_db:.2f}dB,aresample={rate * 4}:filter_size=64,'
            f'alimiter=limit={10 ** (limit_db / 20):.4f}:attack=1:release=50:level=disabled:asc=1,'
            f'aresample={rate}:filter_size=64')


def chapters_written(path):
    r = run(['ffprobe', '-v', 'error', '-show_chapters', '-of', 'json', str(path)])
    return len(json.loads(r.stdout or '{}').get('chapters', []))


def encode_file(src, dest, chapters, bitrate=DEFAULT_BITRATE, title=None, on_progress=None):
    """Encodes src → dest (mono MP3, -16 LUFS as heard, peaks ≤ -1 dB, chapters). chapters: [(start_s, title)].
    on_progress(percent) is called along the way. Returns a summary dict."""
    src, dest = Path(src), Path(dest)
    total = duration_seconds(src)
    channels, source_rate = audio_info(src)
    rate = source_rate if source_rate in (44100, 48000) else 44100
    mono = to_mono(channels)
    chapters = sorted((max(0.0, float(s)), str(t).strip() or f'Chapter {i + 1}') for i, (s, t) in enumerate(chapters) if float(s) < total)
    before = measure(src, total, on_progress, 0, 30, mono)
    if float(before['input_i']) < -70:
        raise EncodeError(f'{src.name} is silent or almost silent.')
    gain = MONO_I - float(before['input_i'])
    meta = metadata_file(chapters, total, title or src.stem)
    tmp = dest.with_name(dest.stem + '.part.mp3')
    limit = LIMIT_DB
    try:
        for attempt in range(3):
            cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(src), '-i', meta,
                   '-map', '0:a:0', '-map_metadata', '1', '-map_chapters', '1',
                   '-af', treatment(mono, gain, rate, limit), '-ac', '1', '-ar', str(rate),
                   '-c:a', 'libmp3lame', '-b:a', f'{bitrate}k', '-id3v2_version', '3', '-write_xing', '1', str(tmp)]
            code, err = _ffmpeg_with_progress(cmd, total, on_progress, 30 + attempt * 5, 85)
            if code != 0:
                raise EncodeError(f'Encoding failed for {src.name}: {err[-500:]}')
            after = measure(tmp, total, on_progress, 85, 99)
            # The encoder can push a peak a little above the limiter: lower the ceiling by the excess and redo.
            if float(after['input_tp']) <= TARGET_TP or attempt == 2:
                break
            limit -= float(after['input_tp']) - TARGET_TP + 0.2
        written = chapters_written(tmp)
        tmp.replace(dest)
    finally:
        Path(meta).unlink(missing_ok=True)
        tmp.unlink(missing_ok=True)
    if on_progress:
        on_progress(100)
    return {
        'path': str(dest), 'bytes': dest.stat().st_size, 'duration': total, 'bitrate': bitrate, 'sample_rate': rate,
        'loudness_before': float(before['input_i']) + AS_HEARD, 'peak_before': float(before['input_tp']),
        'loudness_after': float(after['input_i']) + AS_HEARD, 'peak_after': float(after['input_tp']),
        'chapters': written, 'chapters_expected': len(chapters),
    }


def main():
    p = argparse.ArgumentParser(description='Mono MP3, -16 LUFS as heard, chapters embedded. Batch.')
    p.add_argument('inputs', nargs='+', type=Path, help='audio or video files')
    p.add_argument('--bitrate', type=int, default=DEFAULT_BITRATE, choices=BITRATES, help=f'kbps, default {DEFAULT_BITRATE}')
    p.add_argument('--out', type=Path, help='output folder (default: "ready" next to the first input)')
    args = p.parse_args()

    inputs = [f for f in args.inputs if f.suffix.lower() != '.txt']
    missing = [str(f) for f in inputs if not f.is_file()]
    if missing:
        sys.exit('Not found: ' + ', '.join(missing))
    out_dir = args.out or inputs[0].parent / 'ready'
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        for src in inputs:
            dest = out_dir / (src.stem + '.mp3')
            if dest.resolve() == src.resolve():
                sys.exit(f'{src.name}: output would overwrite the input; choose another --out folder')
            total = duration_seconds(src)
            chapter_file = src.with_name(src.stem + '.chapters.txt')
            chapters = read_chapters(chapter_file, total) if chapter_file.exists() else []
            print(f'{src.name}: {total / 60:.1f} min, {len(chapters)} chapter(s)')
            r = encode_file(src, dest, chapters, args.bitrate)
            print(f'  loudness before: {r["loudness_before"]:.1f} LUFS as heard, peak {r["peak_before"]:.1f} dB')
            print(f'  → {dest}  ({r["bytes"] / 1048576:.1f} MB, {args.bitrate} kbps mono, {r["loudness_after"]:.1f} LUFS as heard, '
                  f'peak {r["peak_after"]:.1f} dB, {r["chapters"]} chapter(s) embedded)')
            if r['chapters'] != r['chapters_expected']:
                print('  WARNING: not all chapters were written')
    except EncodeError as e:
        sys.exit(str(e))
    print(f'Done: {len(inputs)} file(s) in {out_dir}')


if __name__ == '__main__':
    main()
