"""
Podcast Studio self-update: replaces this folder's code with the latest version published on GitHub
(github.com/heyashleylim/hal-website, branch main, folder tools/podcast-studio). The user's work
(~/.cache/podcast-studio) and exports are never touched.

    ./podcast-studio update [--check] [--force]
    ./podcast-studio version

Downloads go through curl (always on macOS, and it uses the system certificates). The installed version is
the commit id in VERSION. A running Studio is stopped so the new code takes effect; it refuses while a file
is transcribing or exporting unless --force (an interrupted transcription restarts from the beginning).
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

REPO = 'heyashleylim/hal-website'
BRANCH = 'main'
FOLDER = 'tools/podcast-studio'
ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT / 'VERSION'
PORT = 8792


def fetch(url, dest=None):
    cmd = ['curl', '-fsSL', '--retry', '2', '--max-time', '60', '-H', 'User-Agent: podcast-studio-updater', url]
    if dest:
        cmd += ['-o', str(dest)]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f'Download failed ({url}): {r.stderr.decode("utf-8", "replace").strip() or r.returncode}')
    return None if dest else r.stdout


def installed():
    """{'commit': sha, 'date': iso} or {} when unknown (e.g. installed from an older zip)."""
    try:
        return json.loads(VERSION_FILE.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def latest():
    data = json.loads(fetch(f'https://api.github.com/repos/{REPO}/commits?sha={BRANCH}&path={FOLDER}&per_page=1'))
    if not data:
        raise RuntimeError('No published version found on GitHub.')
    c = data[0]
    return {'commit': c['sha'], 'date': c['commit']['committer']['date'], 'message': c['commit']['message'].split('\n')[0]}


def files_at(commit):
    tree = json.loads(fetch(f'https://api.github.com/repos/{REPO}/git/trees/{commit}?recursive=1'))
    if tree.get('truncated'):
        raise RuntimeError('GitHub returned an incomplete file list; try again later.')
    prefix = FOLDER + '/'
    return [(t['path'][len(prefix):], t['mode']) for t in tree['tree']
            if t['type'] == 'blob' and t['path'].startswith(prefix)]


def busy_files():
    projects = Path.home() / '.cache' / 'podcast-studio' / 'projects'
    busy = []
    for f in projects.glob('*/project.json'):
        try:
            p = json.loads(f.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        for step in ('transcript', 'export'):
            if p.get(step, {}).get('state') in ('queued', 'running'):
                busy.append(f'{p.get("name", f.parent.name)} ({step})')
    return busy


def running_pids():
    r = subprocess.run(['lsof', '-ti', f'tcp:{PORT}', '-sTCP:LISTEN'], capture_output=True, text=True)
    pids = []
    for pid in r.stdout.split():
        cmd = subprocess.run(['ps', '-o', 'command=', '-p', pid], capture_output=True, text=True).stdout
        if 'studio.py' in cmd:
            pids.append(int(pid))
    return pids


def stop_running():
    pids = running_pids()
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for _ in range(30):
        if not running_pids():
            break
        time.sleep(0.2)
    return bool(pids)


def short(v):
    return f'{v["commit"][:7]} ({v["date"][:10]})' if v.get('commit') else 'unknown'


def run(check=False, force=False):
    cur = installed()
    new = latest()
    print(f'Installed: {short(cur)}')
    print(f'Latest:    {short(new)}  {new["message"]}')
    if cur.get('commit') == new['commit']:
        print('Podcast Studio is up to date.')
        return 0
    if check:
        print('An update is available: run ./podcast-studio update')
        return 0
    busy = busy_files()
    if busy and running_pids() and not force:
        print('Not updated: the Studio is busy with ' + ', '.join(busy) + '.')
        print('Wait until it finishes, or run ./podcast-studio update --force (the job restarts after the update).')
        return 4

    files = files_at(new['commit'])
    if not any(path == 'app/studio.py' for path, _ in files):
        raise RuntimeError('The published version looks incomplete (no app/studio.py); nothing was changed.')
    stage = Path(tempfile.mkdtemp(prefix='podcast-studio-update-'))
    try:
        for path, mode in files:
            dest = stage / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            fetch(f'https://raw.githubusercontent.com/{REPO}/{new["commit"]}/{FOLDER}/{quote(path)}', dest)
            if mode == '100755':
                dest.chmod(0o755)
        for py in stage.rglob('*.py'):
            compile(py.read_text(encoding='utf-8'), str(py), 'exec')  # a broken download fails here, before any change

        was_running = stop_running()
        # Replace the code. app/ is replaced as a whole (old files removed); other top-level files are overwritten.
        new_app = ROOT / 'app.new'
        shutil.rmtree(new_app, ignore_errors=True)
        shutil.copytree(stage / 'app', new_app)
        old_app = ROOT / 'app.old'
        shutil.rmtree(old_app, ignore_errors=True)
        os.replace(ROOT / 'app', old_app)
        os.replace(new_app, ROOT / 'app')
        shutil.rmtree(old_app, ignore_errors=True)
        for item in stage.iterdir():
            if item.name != 'app' and item.is_file():
                tmp = ROOT / (item.name + '.new')
                shutil.copy2(item, tmp)
                os.replace(tmp, ROOT / item.name)
        VERSION_FILE.write_text(json.dumps({'commit': new['commit'], 'date': new['date']}) + '\n', encoding='utf-8')
    finally:
        shutil.rmtree(stage, ignore_errors=True)

    print(f'Updated to {short(new)}.')
    # New requirements, the Claude Code command and file permissions are refreshed by setup.
    subprocess.run(['bash', str(ROOT / 'setup.sh'), '--check'])
    if was_running:
        print('The Studio was stopped to apply the update. Start it again: ./podcast-studio start')
    return 0


def main(argv):
    import argparse
    ap = argparse.ArgumentParser(prog='podcast-studio update', description='Update Podcast Studio from GitHub.')
    ap.add_argument('--check', action='store_true', help='only say whether an update is available')
    ap.add_argument('--force', action='store_true', help='update even while a file is transcribing or exporting')
    args = ap.parse_args(argv)
    try:
        return run(args.check, args.force)
    except Exception as e:  # noqa: BLE001 — shown to a non-technical user via Claude
        print(f'Update failed: {e}')
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
