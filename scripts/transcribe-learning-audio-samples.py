"""Local cached Whisper cross-check. ASR is advisory; never approves or promotes an audition."""
import difflib
import argparse
import importlib.metadata
from collections import Counter
import json
import re
from pathlib import Path

from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/audio-samples/jenny-batch-1'
NUMBERS = {
    'zero point zero one': '0.01', 'two point three': '2.3', 'three point two': '3.2', 'four point one': '4.1',
    'eight hundred and twenty five': '825', 'eight hundred twenty five': '825',
    'two hundred and twenty five': '225', 'two hundred twenty five': '225',
    'one hundred and eighty': '180', 'one hundred eighty': '180',
    'one thousand two hundred': '1200', 'twelve hundred': '1200', 'three hundred': '300', 'one hundred': '100',
    'thirty three': '33', 'twenty five': '25', 'sixty': '60', 'forty': '40', 'thirty': '30', 'eighteen': '18',
    'ten': '10', 'five': '5', 'four': '4', 'three': '3', 'two': '2', 'one': '1', 'zero': '0',
}


def normalize(text):
    text = text.lower().replace('-', ' ').replace('%', ' percent ')
    text = re.sub(r'(?<=\d),(?=\d)', '', text)
    for phrase, number in sorted(NUMBERS.items(), key=lambda item: -len(item[0])):
        text = re.sub(r'\b' + re.escape(phrase) + r'\b', number, text)
    return ' '.join(re.findall(r'\d+(?:\.\d+)?|[a-z]+', text))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=['base', 'small'], default='base')
    parser.add_argument('--only', nargs='+')
    parser.add_argument('--output', default='asr-review.json')
    args = parser.parse_args()
    if Path(args.output).name != args.output:
        raise ValueError('Output must be a filename')
    snapshots = Path.home() / f'.cache/huggingface/hub/models--Systran--faster-whisper-{args.model}/snapshots'
    models = sorted(path for path in snapshots.iterdir() if (path / 'model.bin').exists())
    if not models:
        raise ValueError('No cached base model. No automatic model download is allowed by this script.')
    print(f'Loading cached {args.model} ASR model on CPU; no network or API key.', flush=True)
    model = WhisperModel(str(models[0]), device='cpu', compute_type='int8', cpu_threads=4)
    manifest = json.loads((OUT / 'manifest.json').read_text(encoding='utf-8'))
    results = []
    for entry in manifest['entries']:
        if args.only and entry['file'] not in args.only:
            continue
        segments, info = model.transcribe(str(OUT / entry['file']), language='en', beam_size=5,
            vad_filter=False, condition_on_previous_text=False,
            initial_prompt='Dota 2. Drow, Persecutor, Marksmanship, Sacred Arrow, Necromastery, Disperser, Shiva, Manta Style, Bloodstone.')
        transcript = ' '.join(segment.text.strip() for segment in segments)
        normalized = normalize(transcript)
        missing = [phrase for phrase in entry['numberChecks'] if f' {normalize(phrase)} ' not in f' {normalized} ']
        expected_numbers = Counter(re.findall(r'\b\d+(?:\.\d+)?\b', normalize(entry['script'])))
        recognized_numbers = Counter(re.findall(r'\b\d+(?:\.\d+)?\b', normalized))
        number_counts_match = expected_numbers == recognized_numbers
        similarity = difflib.SequenceMatcher(None, normalize(entry['script']).split(), normalized.split()).ratio()
        results.append({'id': entry['id'], 'name': entry['name'], 'file': entry['file'], 'transcript': transcript,
            'audioSha256': entry['audioSha256'], 'expectedNumbers': dict(expected_numbers), 'recognizedNumbers': dict(recognized_numbers),
            'numberCountsMatch': number_counts_match,
            'missingCriticalNumberChecks': missing, 'normalizedWordSimilarity': round(similarity, 3),
            'status': 'needs-review' if missing or not number_counts_match or similarity < 0.95 else 'asr-check-passed',
            'note': 'Automatic recognition can mishear names or numbers. Listening approval remains false.'})
        print(f"ASR {entry['name']}: similarity {similarity:.3f}; missing number checks: {missing}", flush=True)
        (OUT / args.output).write_text(json.dumps({'schema': 1, 'model': 'faster-whisper-' + args.model,
            'modelRevision': models[0].name, 'fasterWhisperVersion': importlib.metadata.version('faster-whisper'),
            'device': 'cpu/int8', 'advisoryOnly': True, 'entries': results}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
