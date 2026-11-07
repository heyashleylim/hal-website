#!/usr/bin/env python3
"""
Podcast Studio: prepares podcast episodes on this Mac, with a browser UI.

    ./podcast-studio start      (or double-click "Podcast Studio.command", or: python3 app/studio.py)

Then, in the browser page it opens (http://127.0.0.1:8792):
  1. Add one or more audio files (MP3, M4A, WAV, AIFF, or a video such as a CapCut MP4).
  2. Each file is analysed (waveform, pauses) and, if Whisper is installed, transcribed locally (Korean).
  3. Chapters are suggested at the longest pauses, titled with the words that follow; edit, add or delete
     them while listening (click a chapter or a transcript line to jump there).
  4. Select files and export: mono MP3, 96 kbps, -16 LUFS, peaks at most -1 dB, chapters embedded
     (app/encode.py). Exports go to ~/Downloads/Podcast Studio (or --out).

Everything stays on this Mac: the server listens on 127.0.0.1 only and every API call needs the
per-session token embedded in the page. Work files live in ~/.cache/podcast-studio (delete a file
in the UI to remove its work folder). Needs ffmpeg; transcription needs whisper-cpp + a model:
    bash setup.sh   (installs ffmpeg, whisper-cpp and the Whisper model)
Chapter suggestions by AI come from Claude in a Claude Code session: see CLAUDE.md (commands: transcript,
set-chapters).
"""
import argparse
import json
import mimetypes
import os
import queue
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from array import array
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import encode  # noqa: E402

HOME = Path.home()
CACHE = HOME / '.cache' / 'podcast-studio'
PROJECTS = CACHE / 'projects'
MODEL = CACHE / 'models' / 'ggml-large-v3-turbo-q5_0.bin'
APP_DIR = Path(__file__).resolve().parent.parent
UI = Path(__file__).resolve().parent / 'ui'
PLAYABLE = {'.mp3', '.m4a', '.aac', '.wav', '.mp4', '.m4v', '.mov', '.ogg', '.oga', '.opus', '.flac', '.webm'}
ACCEPTED = PLAYABLE | {'.aif', '.aiff', '.caf', '.mkv'}
PEAKS_PER_SECOND = 10
BITRATES = (64, 80, 96, 112, 128)

TOKEN = secrets.token_urlsafe(24)
OUT_DIR = HOME / 'Downloads' / 'Podcast Studio'
locks = {}
locks_guard = threading.Lock()
jobs = queue.Queue()


# ---------- projects on disk ----------

def lock_for(pid):
    with locks_guard:
        return locks.setdefault(pid, threading.Lock())


def pdir(pid):
    if not re.fullmatch(r'[0-9a-f]{32}', pid or ''):
        raise KeyError(pid)
    d = PROJECTS / pid
    if not (d / 'project.json').exists():
        raise KeyError(pid)
    return d


def load(pid):
    return json.loads((pdir(pid) / 'project.json').read_text(encoding='utf-8'))


def save(p):
    d = PROJECTS / p['id']
    tmp = d / 'project.json.tmp'
    tmp.write_text(json.dumps(p, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(d / 'project.json')


def update(pid, fn):
    """Read-modify-write a project under its lock. fn(project) mutates it."""
    with lock_for(pid):
        p = load(pid)
        fn(p)
        save(p)
        return p


def summary(p):
    keys = ('id', 'name', 'created', 'duration', 'analysis', 'transcript', 'export', 'suggested', 'chapters_edited', 'chapters_rev', 'chapters_by', 'ai')
    out = {k: p.get(k) for k in keys}
    out['chapters'] = len(p.get('chapters', []))
    return out


def all_projects():
    out = []
    for d in sorted(PROJECTS.glob('*/project.json'), key=lambda f: f.stat().st_mtime):
        try:
            out.append(json.loads(d.read_text(encoding='utf-8')))
        except (OSError, ValueError):
            continue
    return sorted(out, key=lambda p: p.get('created', 0))


def source_path(p):
    return PROJECTS / p['id'] / ('source' + p['ext'])


# ---------- analysis: duration, waveform, pauses ----------

def compute_peaks(src):
    """One value 0–255 per 1/PEAKS_PER_SECOND s: the loudest sample in that slice."""
    rate = 4000
    proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', str(src), '-vn', '-ac', '1', '-ar', str(rate), '-f', 's16le', '-'],
                            stdout=subprocess.PIPE)
    data = proc.stdout.read()
    proc.wait()
    samples = array('h')
    samples.frombytes(data[: len(data) // 2 * 2])
    if sys.byteorder == 'big':
        samples.byteswap()
    step = rate // PEAKS_PER_SECOND
    peaks = []
    for i in range(0, len(samples), step):
        chunk = samples[i:i + step]
        peak = max(max(chunk), -min(chunk)) if chunk else 0
        peaks.append(min(255, peak * 255 // 32767))
    return peaks


def detect_silences(src):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(src), '-vn', '-af', 'silencedetect=noise=-35dB:d=0.7', '-f', 'null', '-'],
                       capture_output=True, text=True)
    out, start = [], None
    for line in r.stderr.splitlines():
        m = re.search(r'silence_start: (-?[\d.]+)', line)
        if m:
            start = max(0.0, float(m.group(1)))
        m = re.search(r'silence_end: ([\d.]+) \| silence_duration: ([\d.]+)', line)
        if m and start is not None:
            out.append({'start': round(start, 2), 'end': round(float(m.group(1)), 2), 'duration': round(float(m.group(2)), 2)})
            start = None
    return out


def analyse(pid):
    def set_state(state, **kw):
        update(pid, lambda p: p.update(analysis={'state': state, **kw}))
    try:
        set_state('running')
        p = load(pid)
        src = source_path(p)
        duration = encode.duration_seconds(src)
        d = PROJECTS / pid
        if p['ext'] not in PLAYABLE:
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-vn', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', str(d / 'preview.mp3')], check=True)
        (d / 'peaks.json').write_text(json.dumps(compute_peaks(src)))
        silences = detect_silences(src)
        (d / 'silences.json').write_text(json.dumps(silences))

        def done(p):
            p['duration'] = duration
            p['analysis'] = {'state': 'done'}
            if not p.get('chapters_edited'):
                p['chapters'] = suggest(duration, silences, read_transcript(pid))
                p['suggested'] = True
        update(pid, done)
        if whisper_binary() and MODEL.exists():
            update(pid, lambda p: p.update(transcript={'state': 'queued'}))
            jobs.put(('transcribe', pid))
    except Exception as e:  # noqa: BLE001 — show any failure in the UI
        set_state('error', error=str(e)[:500])


# ---------- transcription (whisper.cpp, local) ----------

def whisper_binary():
    for name in ('whisper-cli', 'whisper-cpp'):
        path = shutil.which(name)
        if path:
            return path
    return None


def read_transcript(pid):
    f = PROJECTS / pid / 'transcript.json'
    return json.loads(f.read_text(encoding='utf-8')) if f.exists() else []


def transcribe(pid):
    d = PROJECTS / pid
    wav = d / 'speech-16k.wav'

    def progress(n):
        update(pid, lambda p: p.update(transcript={'state': 'running', 'progress': n}))
    try:
        binary = whisper_binary()
        if not binary or not MODEL.exists():
            raise RuntimeError('Whisper is not installed: run bash setup.sh')
        progress(0)
        p = load(pid)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(source_path(p)), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(wav)], check=True)
        cmd = [binary, '-m', str(MODEL), '-l', 'ko', '-t', str(max(4, (os.cpu_count() or 8) - 2)), '-pp', '-ml', '80', '-sow', '-oj', '-of', str(d / 'whisper'), '-f', str(wav)]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        last = -1
        tail = []
        for line in proc.stdout:
            tail = (tail + [line])[-20:]
            m = re.search(r'progress\s*=\s*(\d+)%', line)
            if m and int(m.group(1)) != last:
                last = int(m.group(1))
                progress(last)
        proc.wait()
        if proc.returncode != 0 or not (d / 'whisper.json').exists():
            raise RuntimeError('Whisper failed: ' + ''.join(tail)[-400:])
        raw = json.loads((d / 'whisper.json').read_text(encoding='utf-8', errors='replace'))
        segments = []
        for s in raw.get('transcription', []):
            text = s.get('text', '').strip()
            if text:
                segments.append({'start': s['offsets']['from'] / 1000, 'end': s['offsets']['to'] / 1000, 'text': text})
        (d / 'transcript.json').write_text(json.dumps(segments, ensure_ascii=False))
        (d / 'whisper.json').unlink(missing_ok=True)
        silences = json.loads((d / 'silences.json').read_text()) if (d / 'silences.json').exists() else []

        def done(p):
            p['transcript'] = {'state': 'done', 'segments': len(segments)}
            if not p.get('chapters_edited'):
                p['chapters'] = suggest(p.get('duration') or 0, silences, segments)
                p['suggested'] = True
        update(pid, done)
    except Exception as e:  # noqa: BLE001
        update(pid, lambda p: p.update(transcript={'state': 'error', 'error': str(e)[:500]}))
    finally:
        wav.unlink(missing_ok=True)


# ---------- chapter suggestions (no AI: longest pauses + transcript) ----------

def short_title(text, limit=32):
    text = re.sub(r'\s+', ' ', text).strip(' .,!?…')
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(' ', 1)[0]
    return (cut or text[:limit]) + '…'


def suggest(duration, silences, segments):
    """Chapter starts at pauses: every long pause (2 s or more) counts, then the longest remaining pauses
    up to about one chapter every 5 minutes (at most 20). Starts stay at least 30 s apart (more on long
    files) and away from the very start and end. Each start snaps to the next sentence (if transcribed)
    and takes its first words as a title."""
    if not duration:
        return [{'start': 0.0, 'title': '들어가며'}]
    target = max(2, min(15, round(duration / 300))) if duration >= 90 else 1
    min_gap = max(30.0, min(120.0, duration / (target * 2.5)))
    edge = 20.0 if duration < 600 else 45.0
    usable = [s for s in silences if s['duration'] >= 0.9 and edge < s['end'] < duration - edge]
    picked = []

    def take(s):
        if len(picked) < 19 and all(abs(s['end'] - t) >= min_gap for t in picked):
            picked.append(s['end'])
    for s in sorted((s for s in usable if s['duration'] >= 2.0), key=lambda s: -s['duration']):
        take(s)
    for s in sorted(usable, key=lambda s: -s['duration']):
        if len(picked) >= target - 1:
            break
        take(s)
    starts = [0.0] + sorted(picked)

    chapters = []
    for i, t in enumerate(starts):
        title = '들어가며' if i == 0 else f'챕터 {i + 1}'
        # The sentence that begins at this pause: Whisper's start times can fall inside the pause, so take the
        # sentence starting nearest to the end of the pause (within 4 s before or 6 s after).
        near = [seg for seg in segments if t - 4 <= seg['start'] <= t + 6]
        seg = min(near, key=lambda x: abs(x['start'] - t)) if near else None
        if seg:
            if seg['start'] > t and seg['start'] - t < 4:
                t = seg['start']  # speech starts a little after the detected pause end
            title = short_title(seg['text'])
        chapters.append({'start': round(t, 1), 'title': title})
    return chapters


# ---------- export ----------

def export(pid, bitrate):
    def progress(n):
        update(pid, lambda p: p.update(export={'state': 'running', 'progress': round(n)}))
    try:
        p = load(pid)
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        previous = p.get('export', {}).get('result')
        dest = Path(previous['path']) if previous else None
        if not dest or dest.parent != OUT_DIR:
            # A new file name in the export folder: never overwrite another file.
            stem = Path(p['name']).stem
            dest, n = OUT_DIR / f'{stem}.mp3', 2
            while dest.exists():
                dest, n = OUT_DIR / f'{stem} ({n}).mp3', n + 1
        chapters = [(c['start'], c['title']) for c in p.get('chapters', [])]
        result = encode.encode_file(source_path(p), dest, chapters, bitrate, title=Path(p['name']).stem, on_progress=progress)
        update(pid, lambda q: q.update(export={'state': 'done', 'progress': 100, 'result': result, 'at': time.time()}))
    except Exception as e:  # noqa: BLE001
        update(pid, lambda q: q.update(export={**q.get('export', {}), 'state': 'error', 'error': str(e)[:500]}))


def worker():
    while True:
        kind, pid, *args = jobs.get()
        try:
            pdir(pid)
        except KeyError:
            continue  # deleted meanwhile
        if kind == 'transcribe':
            transcribe(pid)
        elif kind == 'export':
            export(pid, *args)


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    server_version = 'PodcastStudio'

    def log_message(self, fmt, *args):  # quiet
        pass

    # Only this page may call the API: same host, plus the session token.
    def allowed_host(self):
        host = self.headers.get('Host', '')
        return host in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')

    def token_ok(self, query):
        return secrets.compare_digest(self.headers.get('X-Studio-Token', '') or (query.get('t') or [''])[0], TOKEN)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def fail(self, status, message):
        self.send_json({'error': message}, status)

    def read_json(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'{}') if n else {}

    def send_file(self, path, content_type=None, download_name=None):
        size = path.stat().st_size
        ctype = content_type or mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        start, end = 0, size - 1
        rng = self.headers.get('Range')
        m = re.match(r'bytes=(\d*)-(\d*)$', rng or '')
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            if start > end:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.end_headers()
                return
            self.send_response(206)
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        else:
            self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Cache-Control', 'no-store')
        if download_name:
            from urllib.parse import quote
            self.send_header('Content-Disposition', f"attachment; filename*=UTF-8''{quote(download_name)}")
        self.end_headers()
        if self.command == 'HEAD':
            return
        with open(path, 'rb') as f:
            f.seek(start)
            left = end - start + 1
            try:
                while left > 0:
                    chunk = f.read(min(1 << 20, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def route(self, method):
        if not self.allowed_host():
            return self.fail(403, 'forbidden host')
        url = urlparse(self.path)
        query = parse_qs(url.query)
        parts = [unquote(x) for x in url.path.strip('/').split('/') if x]

        if method == 'GET' and not parts:
            html = (UI / 'index.html').read_text(encoding='utf-8').replace('__STUDIO_TOKEN__', TOKEN)
            body = html.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            return self.wfile.write(body)
        if method == 'GET' and len(parts) == 2 and parts[0] == 'ui' and re.fullmatch(r'[a-z0-9-]+\.(css|js|svg)', parts[1]):
            f = UI / parts[1]
            return self.send_file(f) if f.exists() else self.fail(404, 'not found')
        if not parts or parts[0] != 'api':
            return self.fail(404, 'not found')
        if not self.token_ok(query):
            return self.fail(403, 'bad token')

        try:
            return self.api(method, parts[1:], query)
        except KeyError:
            return self.fail(404, 'file not found in the studio')
        except ValueError as e:
            return self.fail(400, str(e))

    def api(self, method, parts, query):
        if method == 'GET' and parts == ['state']:
            return self.send_json({
                'projects': [summary(p) for p in all_projects()],
                'tools': {'ffmpeg': bool(shutil.which('ffmpeg')), 'whisper': bool(whisper_binary()), 'model': MODEL.exists()},
                'out_dir': str(OUT_DIR), 'jobs_waiting': jobs.qsize(),
                'app_dir': str(APP_DIR).replace(str(HOME), '~', 1),
            })

        if method == 'POST' and parts == ['upload']:
            name = unquote(self.headers.get('X-Filename', '')).strip() or 'audio'
            ext = Path(name).suffix.lower()
            if ext not in ACCEPTED:
                return self.fail(400, f'{name}: unsupported file type ({", ".join(sorted(ACCEPTED))})')
            pid = uuid.uuid4().hex
            d = PROJECTS / pid
            d.mkdir(parents=True)
            left = int(self.headers.get('Content-Length') or 0)
            with open(d / ('source' + ext), 'wb') as f:
                while left > 0:
                    chunk = self.rfile.read(min(1 << 20, left))
                    if not chunk:
                        break
                    f.write(chunk)
                    left -= len(chunk)
            if left > 0:
                shutil.rmtree(d, ignore_errors=True)
                return self.fail(400, 'upload interrupted')
            p = {'id': pid, 'name': name, 'ext': ext, 'created': time.time(), 'duration': None, 'chapters': [],
                 'analysis': {'state': 'queued'}, 'transcript': {'state': 'none'}, 'export': {'state': 'none'}}
            save(p)
            threading.Thread(target=analyse, args=(pid,), daemon=True).start()
            return self.send_json(summary(p))

        if method == 'POST' and parts == ['export']:
            body = self.read_json()
            bitrate = int(body.get('bitrate') or 96)
            if bitrate not in BITRATES:
                raise ValueError('unsupported bitrate')
            ids = [i for i in body.get('ids', []) if isinstance(i, str)]
            for pid in ids:
                p = load(pid)
                if p['analysis'].get('state') != 'done':
                    raise ValueError(f'{p["name"]} is still being analysed')
            for pid in ids:
                update(pid, lambda p: p.update(export={**p.get('export', {}), 'state': 'queued', 'progress': 0, 'error': None}))
                jobs.put(('export', pid, bitrate))
            return self.send_json({'queued': len(ids)})

        if len(parts) >= 2 and parts[0] == 'projects':
            pid, rest = parts[1], parts[2:]
            d = pdir(pid)
            if method == 'GET' and not rest:
                p = load(pid)
                peaks = json.loads((d / 'peaks.json').read_text()) if (d / 'peaks.json').exists() else []
                return self.send_json({**p, 'peaks': peaks, 'peaks_per_second': PEAKS_PER_SECOND, 'segments': read_transcript(pid)})
            if method in ('GET', 'HEAD') and rest == ['audio']:
                p = load(pid)
                preview = d / 'preview.mp3'
                return self.send_file(preview if preview.exists() else source_path(p))
            if method in ('GET', 'HEAD') and rest == ['output']:
                p = load(pid)
                result = p.get('export', {}).get('result')
                if not result or not Path(result['path']).exists():
                    return self.fail(404, 'not exported yet')
                return self.send_file(Path(result['path']), 'audio/mpeg', Path(result['path']).name)
            if method == 'PUT' and rest == ['chapters']:
                chapters = []
                for c in self.read_json().get('chapters', []):
                    start = float(c.get('start', 0))
                    if not (0 <= start < 86400):
                        raise ValueError('chapter time out of range')
                    chapters.append({'start': round(start, 2), 'title': str(c.get('title', ''))[:200]})
                chapters.sort(key=lambda c: c['start'])
                p = update(pid, lambda p: p.update(chapters=chapters, chapters_edited=True, suggested=False, chapters_by='you'))
                return self.send_json({'chapters': p['chapters']})
            if method == 'POST' and rest == ['suggest']:
                silences = json.loads((d / 'silences.json').read_text()) if (d / 'silences.json').exists() else []
                p = update(pid, lambda p: p.update(chapters=suggest(p.get('duration') or 0, silences, read_transcript(pid)), suggested=True, chapters_edited=False, chapters_by='pauses'))
                return self.send_json({'chapters': p['chapters']})
            if method == 'POST' and rest == ['transcribe']:
                if not whisper_binary() or not MODEL.exists():
                    raise ValueError('Whisper is not installed yet: run bash setup.sh (or ask Claude to set up Podcast Studio)')
                update(pid, lambda p: p.update(transcript={'state': 'queued'}))
                jobs.put(('transcribe', pid))
                return self.send_json({'queued': True})
            if method == 'POST' and rest == ['reveal']:
                result = load(pid).get('export', {}).get('result')
                if not result or not Path(result['path']).exists():
                    return self.fail(404, 'not exported yet')
                subprocess.run(['open', '-R', result['path']])
                return self.send_json({'ok': True})
            if method == 'DELETE' and not rest:
                shutil.rmtree(d, ignore_errors=True)
                return self.send_json({'deleted': pid})
        return self.fail(404, 'unknown endpoint')

    def do_GET(self):
        self.route('GET')

    def do_HEAD(self):
        self.route('HEAD')

    def do_POST(self):
        self.route('POST')

    def do_PUT(self):
        self.route('PUT')

    def do_DELETE(self):
        self.route('DELETE')


# ---------- command line (used by Claude Code: see CLAUDE.md) ----------

def find_project(ref):
    """A project by id, id prefix, or (part of) its file name."""
    projects = all_projects()
    exact = [p for p in projects if p['id'] == ref or p['id'].startswith(ref)]
    if len(exact) == 1:
        return exact[0]
    named = [p for p in projects if ref.lower() in p['name'].lower()]
    if len(named) == 1:
        return named[0]
    if not exact and not named:
        sys.exit(f'No file matches "{ref}". Run: studio.py list')
    sys.exit(f'"{ref}" matches several files: ' + ', '.join(p['name'] for p in (exact or named)))


def long_pauses(pid, minimum=1.5):
    f = PROJECTS / pid / 'silences.json'
    return [s for s in json.loads(f.read_text()) if s['duration'] >= minimum] if f.exists() else []


def transcript_text(p):
    """Everything an assistant needs to suggest chapters, as plain text."""
    lines = [f'File: {p["name"]}', f'Duration: {fmt_time(p.get("duration") or 0)} ({round(p.get("duration") or 0)} s)']
    pauses = long_pauses(p['id'])
    if pauses:
        lines.append('Long pauses (end time, length): ' + ', '.join(f'{fmt_time(x["end"])} ({x["duration"]:.1f}s)' for x in pauses))
    if p.get('chapters'):
        lines.append('Current chapters: ' + '; '.join(f'{fmt_time(c["start"])} {c["title"]}' for c in p['chapters']))
    segments = read_transcript(p['id'])
    lines.append('')
    lines.append('Transcript (start time in seconds, then text):' if segments else 'No transcript yet.')
    lines += [f'[{s["start"]:.1f}] {s["text"]}' for s in segments]
    return '\n'.join(lines)


def fmt_time(t):
    t = float(t)
    h, m, s = int(t // 3600), int(t % 3600 // 60), t % 60
    return (f'{h}:{m:02d}:' if h else f'{m}:') + f'{s:04.1f}'


def clean_chapters(items, duration):
    """Validates [{start, title}] (start in seconds or "m:ss"), sorted, first at 0."""
    out = []
    for c in items:
        start = c.get('start')
        start = encode.parse_time(start) if isinstance(start, str) else float(start)
        title = str(c.get('title', '')).strip()[:200]
        if not title or start < 0 or (duration and start >= duration):
            continue
        out.append({'start': round(start, 1), 'title': title})
    out.sort(key=lambda c: c['start'])
    if out and out[0]['start'] > 0:
        out[0]['start'] = 0.0
    dedup = []
    for c in out:
        if not dedup or c['start'] - dedup[-1]['start'] >= 1:
            dedup.append(c)
    return dedup


def apply_chapters(pid, chapters, by):
    return update(pid, lambda p: p.update(chapters=chapters, chapters_edited=True, suggested=False,
                                          chapters_by=by, chapters_rev=uuid.uuid4().hex[:8]))


def cli(argv):
    global OUT_DIR
    ap = argparse.ArgumentParser(prog='studio.py', description='Podcast Studio (no command: start the app).')
    sub = ap.add_subparsers(dest='cmd')
    sub.add_parser('status', help='are ffmpeg, Whisper, the model and Claude Code available?')
    sub.add_parser('list', help='files in the studio')
    t = sub.add_parser('transcript', help="a file's transcript, pauses and chapters (for suggesting chapters)")
    t.add_argument('file', help='id, id prefix or part of the file name')
    c = sub.add_parser('set-chapters', help='replace a file\'s chapters from JSON [{"start": seconds or "m:ss", "title": "..."}]')
    c.add_argument('file')
    c.add_argument('json', help='path to a JSON file, or - for stdin')
    e = sub.add_parser('export', help='export files now (mono MP3, -16 LUFS, chapters) to the export folder')
    e.add_argument('file', nargs='?', help='id, id prefix or part of the file name')
    e.add_argument('--all', action='store_true', help='every analysed file')
    e.add_argument('--bitrate', type=int, default=96, choices=BITRATES)
    e.add_argument('--out', type=Path, help='export folder (default: ~/Downloads/Podcast Studio)')
    args = ap.parse_args(argv)
    PROJECTS.mkdir(parents=True, exist_ok=True)
    if args.cmd == 'status':
        print(json.dumps({'ffmpeg': bool(shutil.which('ffmpeg')), 'whisper': bool(whisper_binary()), 'model': MODEL.exists(),
                          'model_path': str(MODEL), 'claude': bool(shutil.which('claude')), 'projects': str(PROJECTS)}, indent=1))
    elif args.cmd == 'list':
        for p in all_projects():
            print(f'{p["id"][:8]}  {fmt_time(p.get("duration") or 0):>9}  transcript={p.get("transcript", {}).get("state")}  '
                  f'chapters={len(p.get("chapters", []))}  export={p.get("export", {}).get("state")}  {p["name"]}')
    elif args.cmd == 'transcript':
        print(transcript_text(find_project(args.file)))
    elif args.cmd == 'set-chapters':
        p = find_project(args.file)
        raw = sys.stdin.read() if args.json == '-' else Path(args.json).read_text(encoding='utf-8')
        data = json.loads(raw)
        chapters = clean_chapters(data.get('chapters', data) if isinstance(data, dict) else data, p.get('duration'))
        if not chapters:
            sys.exit('No valid chapters in the JSON.')
        apply_chapters(p['id'], chapters, 'claude')
        print(f'{len(chapters)} chapters saved for {p["name"]}. The open Studio page updates within 2 seconds.')
        for ch in chapters:
            print(f'  {fmt_time(ch["start"])}  {ch["title"]}')
    elif args.cmd == 'export':
        if args.out:
            OUT_DIR = args.out.expanduser()
        if not args.all and not args.file:
            sys.exit('Name a file, or use --all.')
        targets = [p for p in all_projects() if p.get('analysis', {}).get('state') == 'done'] if args.all else [find_project(args.file)]
        for p in targets:
            print(f'Exporting {p["name"]} …', flush=True)
            export(p['id'], args.bitrate)
            r = load(p['id']).get('export', {})
            if r.get('state') == 'done':
                x = r['result']
                print(f'  → {x["path"]}  ({x["bytes"] / 1048576:.1f} MB, {x["loudness_after"]:.1f} LUFS, peak {x["peak_after"]:.1f} dB, {x["chapters"]} chapters)')
            else:
                print(f'  ✗ {r.get("error")}')


def main(argv=None):
    global OUT_DIR
    ap = argparse.ArgumentParser(prog='podcast-studio start', description='Podcast Studio: chapters + mono MP3, -16 LUFS, on this Mac.')
    ap.add_argument('--port', type=int, default=8792)
    ap.add_argument('--out', type=Path, default=OUT_DIR, help='export folder (default: ~/Downloads/Podcast Studio)')
    ap.add_argument('--no-open', action='store_true', help="don't open the browser")
    args = ap.parse_args(argv)
    OUT_DIR = args.out.expanduser()
    if not shutil.which('ffmpeg'):
        sys.exit('ffmpeg is required: brew install ffmpeg')
    PROJECTS.mkdir(parents=True, exist_ok=True)
    # Jobs interrupted by a previous quit are re-queued.
    for p in all_projects():
        if p.get('analysis', {}).get('state') in ('queued', 'running'):
            threading.Thread(target=analyse, args=(p['id'],), daemon=True).start()
        if p.get('transcript', {}).get('state') in ('queued', 'running'):
            jobs.put(('transcribe', p['id']))
        if p.get('export', {}).get('state') in ('queued', 'running'):
            update(p['id'], lambda q: q.update(export={**q['export'], 'state': 'none'}))
    threading.Thread(target=worker, daemon=True).start()
    url = f'http://127.0.0.1:{args.port}/'
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError:
        print(f'Podcast Studio is already running: {url}', flush=True)
        if not args.no_open:
            webbrowser.open(url)
        return
    print(f'Podcast Studio: {url}  (exports: {OUT_DIR})  — press Ctrl+C to quit', flush=True)
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nBye.')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] in ('status', 'list', 'transcript', 'set-chapters', 'export', '-h', '--help'):
        cli(sys.argv[1:])
    elif len(sys.argv) > 1 and sys.argv[1] == 'start':
        main(sys.argv[2:])
    else:
        main(sys.argv[1:])
