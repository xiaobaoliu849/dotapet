"""Generate a bounded audition batch with the original Jenny voice; never replace app assets."""
import asyncio
import argparse
import hashlib
import importlib.metadata
import json
from datetime import datetime, timezone
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'audio-samples' / 'jenny-batch-1'


def sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', nargs='+')
    parser.add_argument('--rate')
    parser.add_argument('--variant', default='')
    args = parser.parse_args()
    if args.variant and not args.variant.replace('-', '').isalnum():
        raise ValueError('Invalid variant filename')
    plan = json.loads((ROOT / 'docs/audio-samples/batch-plan.json').read_text(encoding='utf-8'))
    selected = [entry for entry in plan['entries'] if not args.only or entry['id'] in args.only]
    if not selected:
        raise ValueError('No selected scripts')
    if not 1 <= len(plan['entries']) <= 10:
        raise ValueError('Audition batches must contain one to ten scripts')
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_file = OUT / 'manifest.json'
    results = json.loads(manifest_file.read_text(encoding='utf-8'))['entries'] if manifest_file.exists() else []
    for index, entry in enumerate(selected):
        if not entry.get('sourceReviewed') or sha(entry['script']) != entry['scriptSha256'] or sha(entry['sourceText']) != entry['sourceTextSha256']:
            raise ValueError('Unreviewed or modified script: ' + entry['id'])
        filename = entry['id'].replace(':', '-') + ('-' + args.variant if args.variant else '') + '.mp3'
        target = OUT / filename
        temporary = OUT / (filename + '.tmp')
        metadata = OUT / (filename + '.boundaries.jsonl')
        error = None
        for attempt in range(3):
            try:
                communicate = edge_tts.Communicate(entry['script'], plan['voice'], rate=args.rate or plan['rate'],
                    pitch=plan['pitch'], volume=plan['volume'], boundary='WordBoundary', connect_timeout=15, receive_timeout=45)
                await asyncio.wait_for(communicate.save(str(temporary), str(metadata)), timeout=60)
                if temporary.stat().st_size < 1000:
                    raise ValueError('Empty or incomplete MP3')
                temporary.replace(target)
                error = None
                break
            except Exception as exc:
                error = exc
                if attempt < 2:
                    await asyncio.sleep(2)
        if error:
            raise error
        results = [old for old in results if old['file'] != filename]
        results.append({**entry, 'file': filename, 'variant': args.variant or 'original-speed', 'bytes': target.stat().st_size,
            'audioSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
            'generatedAt': datetime.now(timezone.utc).isoformat(), 'provider': 'Microsoft Edge online speech via edge-tts',
            'edgeTtsVersion': importlib.metadata.version('edge-tts'),
            'voice': plan['voice'], 'rate': args.rate or plan['rate'], 'pitch': plan['pitch'], 'volume': plan['volume'],
            'playbackRate': 1, 'audioValidation': 'pending', 'listeningApproved': False, 'promoted': False})
        print(f"Generated {index+1}/{len(selected)}: {entry['name']} {args.variant} ({target.stat().st_size} bytes)", flush=True)
        (OUT / 'manifest.json').write_text(json.dumps({'schema': 1, 'entries': results}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    asyncio.run(main())
