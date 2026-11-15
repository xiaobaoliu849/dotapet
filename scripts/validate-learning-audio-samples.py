"""Decode every sample, measure duration/levels, and retain the audition-only status."""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/audio-samples/jenny-batch-1'


def main():
    manifest = json.loads((OUT / 'manifest.json').read_text(encoding='utf-8'))
    for entry in manifest['entries']:
        audio = OUT / entry['file']
        probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
            'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', str(audio)],
            check=True, capture_output=True, text=True)
        metadata = json.loads(probe.stdout)
        duration = float(metadata['format']['duration'])
        decode = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(audio), '-af', 'volumedetect',
            '-f', 'null', '-'], capture_output=True, text=True)
        if decode.returncode != 0 or duration <= 0:
            raise ValueError('Audio decode failed: ' + entry['id'])
        peak = re.search(r'max_volume: ([\-\d.]+) dB', decode.stderr)
        mean = re.search(r'mean_volume: ([\-\d.]+) dB', decode.stderr)
        peak_db = float(peak.group(1)) if peak else None
        wpm = len(entry['script'].split()) / duration * 60
        entry['technicalValidation'] = {'durationSeconds': round(duration, 3),
            'stream': metadata['streams'][0], 'decodedCompletely': True,
            'peakDb': peak_db, 'meanDb': float(mean.group(1)) if mean else None,
            'approximateWordsPerMinute': round(wpm, 1),
            'peakNearFullScale': peak_db is not None and peak_db >= -0.1,
            'pacingNeedsReview': not 110 <= wpm <= 200}
        entry['audioValidation'] = 'technical-pass'
        print(f"Validated {entry['name']}: {duration:.1f}s, {wpm:.0f} words/min, peak {peak_db} dB", flush=True)
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
