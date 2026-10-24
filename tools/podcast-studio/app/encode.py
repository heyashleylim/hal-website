#!/usr/bin/env python3
"""
Prepares podcast episodes for upload: mono MP3 at a fixed bitrate, loudness at -16 LUFS (true peak -1 dB,
Apple's guideline), and chapters embedded in the file (read by Apple Podcasts, Pocket Casts, Overcast).

Used by Podcast Studio (app/studio.py) and usable on its own, on many files at once.
Needs ffmpeg (brew install ffmpeg). Any input ffmpeg reads works: MP3, WAV, M4A, or a video export
(MP4/MOV, e.g. from CapCut): only the audio is kept.

    python3 app/encode.py ~/Podcast/module-*.mp3
    python3 app/encode.py ~/Podcast/*.mp4 --bitrate 64 --out ~/Podcast/ready

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

TARGET_I, TARGET_TP, TARGET_LRA = -16.0, -1.0, 11.0


class EncodeError(Exception):
    pass


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


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
    proc = subprocess.Popen(cmd[:1] + ['-progress', 'pipe:1', '-nostats'] + cmd[1:], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
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


def measure(path, total=None, on_progress=None, lo=0, hi=0):
    """Loudness measurement (ffmpeg loudnorm, first pass). Returns ffmpeg's JSON fields."""
    cmd = ['ffmpeg', '-hide_banner', '-i', str(path), '-vn', '-ac', '1',
           '-af', f'loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json', '-f', 'null', '-']
    code, err = _ffmpeg_with_progress(cmd, total, on_progress, lo, hi)
    m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', err)
    if code != 0 or not m:
        raise EncodeError(f'Loudness measurement failed for {Path(path).name}: {err[-500:]}')
    return json.loads(m.group(0))


def chapters_written(path):
    r = run(['ffprobe', '-v', 'error', '-show_chapters', '-of', 'json', str(path)])
    return len(json.loads(r.stdout or '{}').get('chapters', []))


def encode_file(src, dest, chapters, bitrate=96, title=None, on_progress=None):
    """Encodes src → dest (mono MP3, -16 LUFS, -1 dB peaks, chapters). chapters: [(start_s, title)].
    on_progress(percent) is called along the way. Returns a summary dict."""
    src, dest = Path(src), Path(dest)
    total = duration_seconds(src)
    chapters = sorted((max(0.0, float(s)), str(t).strip() or f'Chapter {i + 1}') for i, (s, t) in enumerate(chapters) if float(s) < total)
    before = measure(src, total, on_progress, 0, 35)
    loudnorm = (f'loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}'
                f':measured_I={before["input_i"]}:measured_TP={before["input_tp"]}:measured_LRA={before["input_lra"]}'
                f':measured_thresh={before["input_thresh"]}:offset={before["target_offset"]}:linear=true')
    meta = metadata_file(chapters, total, title or src.stem)
    tmp = dest.with_name(dest.stem + '.part.mp3')
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(src), '-i', meta,
           '-map', '0:a:0', '-map_metadata', '1', '-map_chapters', '1',
           '-af', loudnorm, '-ac', '1', '-ar', '44100',
           '-c:a', 'libmp3lame', '-b:a', f'{bitrate}k', '-id3v2_version', '3', '-write_xing', '1', str(tmp)]
    try:
        code, err = _ffmpeg_with_progress(cmd, total, on_progress, 35, 85)
        if code != 0:
            raise EncodeError(f'Encoding failed for {src.name}: {err[-500:]}')
        after = measure(tmp, total, on_progress, 85, 99)
        written = chapters_written(tmp)
        tmp.replace(dest)
    finally:
        Path(meta).unlink(missing_ok=True)
        tmp.unlink(missing_ok=True)
    if on_progress:
        on_progress(100)
    return {
        'path': str(dest), 'bytes': dest.stat().st_size, 'duration': total, 'bitrate': bitrate,
        'loudness_before': float(before['input_i']), 'peak_before': float(before['input_tp']),
        'loudness_after': float(after['input_i']), 'peak_after': float(after['input_tp']),
        'chapters': written, 'chapters_expected': len(chapters),
    }


def main():
    p = argparse.ArgumentParser(description='Mono MP3, -16 LUFS, chapters embedded. Batch.')
    p.add_argument('inputs', nargs='+', type=Path, help='audio or video files')
    p.add_argument('--bitrate', type=int, default=96, choices=[64, 80, 96, 112, 128], help='kbps, default 96')
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
            print(f'  loudness before: {r["loudness_before"]:.1f} LUFS, peak {r["peak_before"]:.1f} dB')
            print(f'  → {dest}  ({r["bytes"] / 1048576:.1f} MB, {args.bitrate} kbps mono, {r["loudness_after"]:.1f} LUFS, '
                  f'peak {r["peak_after"]:.1f} dB, {r["chapters"]} chapter(s) embedded)')
            if r['chapters'] != r['chapters_expected']:
                print('  WARNING: not all chapters were written')
    except EncodeError as e:
        sys.exit(str(e))
    print(f'Done: {len(inputs)} file(s) in {out_dir}')


if __name__ == '__main__':
    main()
