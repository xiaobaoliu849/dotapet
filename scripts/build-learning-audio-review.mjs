import fs from 'node:fs';
const directory = new URL('../docs/audio-samples/', import.meta.url);
const read = path => JSON.parse(fs.readFileSync(new URL(path, directory)));
const plan = read('batch-plan.json'), manifest = read('jenny-batch-1/manifest.json');
const asr = read('jenny-batch-1/asr-review.json');
const archive = JSON.parse(fs.readFileSync(new URL('../src/learning/audio-manifest.json', import.meta.url)));
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const audio = (src, label) => `<label>${escape(label)}<audio controls preload="none" src="${escape(src)}"></audio></label>`;
const cards = plan.entries.map(entry => {
  const tracks = manifest.entries.filter(track => track.id === entry.id);
  const players = tracks.map(track => {
    const check = asr.entries.find(row => row.file === track.file && row.audioSha256 === track.audioSha256);
    if (!check || !check.numberCountsMatch) throw new Error(`Missing matching ASR number check: ${track.file}`);
    return audio('jenny-batch-1/' + track.file, `${track.rate === '+0%' ? 'New · original speed / 新录音 · 原速' : 'New · 10% faster / 新录音 · 快 10%'} · ${track.technicalValidation.durationSeconds}s`);
  });
  const old = archive.entries[entry.id];
  return `<article><h2>${escape(entry.name)}</h2><p class="note">${escape(entry.sourceReviewNotes)}</p><div class="players">${audio('../../src/renderer/assets/learning-audio/' + old.file, 'Original archive / 历史录音 · mechanics may be outdated')}${players.join('')}</div><p class="check">Decoded completely · no near-full-scale peaks · ASR number checks passed</p><details><summary>Reviewed spoken script / 查看台词</summary><p>${escape(entry.script)}</p><a href="${escape(entry.sourceUrl)}">Official source / 官方来源</a></details></article>`;
});
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; base-uri 'none'"><title>DotaPad · Jenny audio audition</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f6ef;color:#293c2a;font:16px/1.6 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1040px;margin:auto;padding:36px 24px}header{margin-bottom:28px}.eyebrow{letter-spacing:2px;font-size:12px;color:#66814e}h1{font-size:34px;line-height:1.2}h2{font-size:22px}article{padding:24px;border:1px solid #d7e1cc;background:white;border-radius:16px;margin:18px 0}.players{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}.players label{font-size:12px;color:#596b51}.players audio{display:block;width:100%;margin-top:8px}.note,.check{font-size:13px;color:#64755b}.check{color:#4e7339}details p{white-space:pre-line;font-size:14px}.banner{padding:18px;background:#e5edda;border-radius:12px}a{color:#426833}footer{color:#68785f;font-size:13px;margin-top:30px}
</style></head><body><main><header><p class="eyebrow">DOTAPAD · AUDIO REVIEW</p><h1>Same Jenny voice. Current explanations.</h1><p>8 lessons · 2 optional pace comparisons · no API key required</p><div class="banner">这些是试听样本，尚未替换应用中的任何录音。请比较专有名词、数值和语速。<br>Audition only. Technical checks and speech recognition do not replace listening. All listening approvals remain pending.</div></header>${cards.join('')}<footer>Voice: en-US-JennyNeural · edge-tts · saved MP3 playback is offline. Generating new recordings requires internet. The original archives remain unchanged.</footer></main></body></html>`;
fs.writeFileSync(new URL('REVIEW.html', directory), html);
const lines = ['# Jenny audition batch — eight current lessons', '',
  'No API key was used. Voice: `en-US-JennyNeural` through Edge TTS. These are audition samples; no app audio was replaced.', '',
  '[Open the comparison player](REVIEW.html). It includes the original archive, new original-speed recording and two optional 10%-faster variants.', '',
  '| Lesson | New original-speed sample | Optional faster sample |', '| --- | --- | --- |',
  ...plan.entries.map(entry => { const normal = manifest.entries.find(track => track.id === entry.id && track.rate === '+0%'), faster = manifest.entries.find(track => track.id === entry.id && track.rate === '+10%'); return `| ${entry.name} | [Listen](jenny-batch-1/${normal.file}) · ${normal.technicalValidation.durationSeconds}s | ${faster ? `[Listen](jenny-batch-1/${faster.file}) · ${faster.technicalValidation.durationSeconds}s` : '—'} |`; }), '',
  'Each sample has an exact script hash, source-text hash, audio hash, voice settings, source-check time and technical validation. Local Whisper checks recognized every listed critical number and the complete numeric occurrence counts. This is an automated cross-check, not subjective listening approval.', '',
  '## Improvements made during this batch', '',
  '- Rewrote slash-separated Sacred Arrow stun levels into explicit level-by-level speech.',
  '- Read negative slow/reduction modifiers as clear reductions while preserving their magnitudes.',
  '- Improved Sacred Arrow’s final creep sentence after the first recognizer struggled with it.',
  '- Replaced Bloodstone’s fragmented heading-heavy phrasing with flowing sentences. Original-speed pacing improved from about 90 to 125 words per minute; all gameplay numbers stayed unchanged.',
  '- Kept the original voice and default speed; added two optional faster comparisons instead of changing the app-wide speed.', '',
  '## Reproduce', '', '```powershell', 'node scripts/prepare-learning-audio-samples.mjs', 'python scripts/generate-learning-audio-samples.py', 'python scripts/validate-learning-audio-samples.py', '& D:/conda/envs/whisperx/python.exe -u scripts/transcribe-learning-audio-samples.py', 'node scripts/build-learning-audio-review.mjs', '```', '',
  'Generation requires Python `edge-tts` (used: 7.3.1) and internet; technical checks use `ffmpeg`/`ffprobe`. Optional local ASR uses `faster-whisper` (working environment: 1.1.0) and a cached base model, with a cached small model for cross-checks. No model download is performed by the ASR script. The general Conda environment had an OpenMP conflict; the existing `whisperx` environment successfully ran the local checks.', '',
  'Sample promotion and the remaining changed-source recordings remain separate work. Hearing the auditions is the next quality check; the application’s existing files are intact.', ''];
fs.writeFileSync(new URL('README.md', directory), lines.join('\n'));
console.log('Built docs/audio-samples/REVIEW.html and README.md');
