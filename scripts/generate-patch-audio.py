"""Synthesize and validate MP3 recordings for newly added Patch 7.42 abilities and items."""
import asyncio
import hashlib
import importlib.metadata
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[1]
CATALOG_FILE = ROOT / 'src' / 'learning' / 'catalog.json'
MANIFEST_FILE = ROOT / 'src' / 'learning' / 'audio-manifest.json'
CHANGES_FILE = ROOT / 'docs' / 'audits' / 'last-refresh-changes.json'
AUDIO_DIR = ROOT / 'src' / 'renderer' / 'assets' / 'learning-audio'

VOICE = 'en-US-JennyNeural'
RATE = '+0%'
PITCH = '+0Hz'
VOLUME = '+0%'
PATCH = '7.42'


def sha_text(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build_script(lesson: dict) -> tuple[str, str]:
    desc = (lesson.get('descriptionEn') or '').strip()
    if not desc:
        return (lesson['en'], 'name')
    # Collapse whitespace/newlines cleanly without changing any words or numbers.
    cleaned = re.sub(r'\s+', ' ', desc).strip()
    return (f"{lesson['en']}. {cleaned}", 'explanation')


def validate_mp3(path: Path) -> dict:
    probe = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration,bit_rate:stream=codec_name,sample_rate,channels', '-of', 'json', str(path)],
        capture_output=True, text=True, check=True,
    )
    info = json.loads(probe.stdout)
    duration = float(info['format']['duration'])
    decode = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'null', '-'],
        capture_output=True, text=True, check=True,
    )
    if decode.stderr.strip():
        raise RuntimeError(f'FFmpeg decode error for {path.name}: {decode.stderr.strip()}')
    if duration <= 0.4:
        raise RuntimeError(f'Suspiciously short MP3 ({duration}s): {path.name}')
    return {
        'decodedCompletely': True,
        'durationSeconds': round(duration, 3),
        'codec': info['streams'][0].get('codec_name'),
        'sampleRate': int(info['streams'][0].get('sample_rate', 0)),
        'channels': int(info['streams'][0].get('channels', 0)),
    }


async def synthesize_one(script: str, target: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix('.mp3.tmp')
    last_err = None
    for attempt in range(3):
        try:
            comm = edge_tts.Communicate(
                script, VOICE, rate=RATE, pitch=PITCH, volume=VOLUME,
                connect_timeout=15, receive_timeout=45,
            )
            await asyncio.wait_for(comm.save(str(tmp)), timeout=60)
            if tmp.stat().st_size < 1000:
                raise ValueError('Generated MP3 too small')
            tmp.replace(target)
            return
        except Exception as exc:
            last_err = exc
            if attempt < 2:
                await asyncio.sleep(2)
    raise last_err


async def main():
    catalog = json.loads(CATALOG_FILE.read_text(encoding='utf-8'))
    manifest = json.loads(MANIFEST_FILE.read_text(encoding='utf-8'))
    changes = json.loads(CHANGES_FILE.read_text(encoding='utf-8'))

    lesson_map = {row['id']: row for row in catalog['lessons']}
    added_ids = [row['id'] for row in changes['changes'] if row['type'] == 'added']
    removed_ids = [row['id'] for row in changes['changes'] if row['type'] == 'removed']

    # 1. Prune entries removed in Patch 7.42 from manifest (keep tracked archive files on disk).
    pruned = 0
    for rid in removed_ids:
        if manifest['entries'].pop(rid, None):
            pruned += 1
    print(f'Pruned {pruned} removed lessons from manifest.', flush=True)

    # 2. Generate MP3s for all newly added 7.42 abilities and items.
    edge_version = importlib.metadata.version('edge-tts')
    generated = []
    for idx, lid in enumerate(added_ids, 1):
        lesson = lesson_map[lid]
        kind, numeric_id = lid.split(':')
        rel_file = f'{kind}/{numeric_id}.mp3'
        target = AUDIO_DIR / rel_file
        script, content_type = build_script(lesson)
        if re.search(r'%\w+%', script):
            raise ValueError(f'Unresolved placeholder in script for {lid}: {script}')

        await synthesize_one(script, target)
        tech = validate_mp3(target)
        raw = target.read_bytes()
        manifest['entries'][lid] = {
            'file': rel_file,
            'name': lesson['en'],
            'content': content_type,
            'bytes': len(raw),
            'audioSha256': sha_bytes(raw),
            'script': script,
            'scriptSha256': sha_text(script),
            'generatedAt': datetime.now(timezone.utc).isoformat(),
            'catalogFetchedAt': catalog['fetchedAt'],
            'patch': PATCH,
            'provider': 'Microsoft Edge online speech via edge-tts',
            'edgeTtsVersion': edge_version,
            'voice': VOICE,
            'rate': RATE,
            'pitch': PITCH,
            'volume': VOLUME,
            'playbackRate': 1,
            'technicalValidation': tech,
        }
        generated.append({'id': lid, 'name': lesson['en'], 'file': rel_file, 'bytes': len(raw), 'durationSeconds': tech['durationSeconds']})
        print(f'[{idx}/{len(added_ids)}] Generated & validated {lid} ({lesson["en"]}): {len(raw)} bytes, {tech["durationSeconds"]}s', flush=True)

    # 3. Recompute manifest.missing against the current catalog.
    manifest['entries'] = dict(sorted(manifest['entries'].items()))
    manifest['missing'] = [
        {'id': row['id'], 'name': row['en'], 'kind': row['kind']}
        for row in catalog['lessons']
        if row['id'] not in manifest['entries'] or manifest['entries'][row['id']].get('name') != row['en']
    ]
    manifest['updatedAt'] = datetime.now(timezone.utc).isoformat()
    manifest['patch'] = PATCH
    MANIFEST_FILE.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Done! Total recordings: {len(manifest["entries"])}, missing: {len(manifest["missing"])}.', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
