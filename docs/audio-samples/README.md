# Jenny audition batch — eight current lessons

No API key was used. Voice: `en-US-JennyNeural` through Edge TTS. These are audition samples; no app audio was replaced.

[Open the comparison player](REVIEW.html). It includes the original archive, new original-speed recording and two optional 10%-faster variants.

| Lesson | New original-speed sample | Optional faster sample |
| --- | --- | --- |
| Persecutor | [Listen](jenny-batch-1/ability-1447.mp3) · 15.096s | — |
| Marksmanship | [Listen](jenny-batch-1/ability-5022.mp3) · 17.664s | — |
| Sacred Arrow | [Listen](jenny-batch-1/ability-5048.mp3) · 32.472s | — |
| Necromastery | [Listen](jenny-batch-1/ability-5062.mp3) · 14.208s | — |
| Disperser | [Listen](jenny-batch-1/item-1097.mp3) · 41.28s | — |
| Shiva's Guard | [Listen](jenny-batch-1/item-119.mp3) · 24.888s | — |
| Manta Style | [Listen](jenny-batch-1/item-147.mp3) · 20.496s | [Listen](jenny-batch-1/item-147-plus10.mp3) · 18.648s |
| Bloodstone | [Listen](jenny-batch-1/item-121.mp3) · 16.824s | [Listen](jenny-batch-1/item-121-plus10.mp3) · 15.288s |

Each sample has an exact script hash, source-text hash, audio hash, voice settings, source-check time and technical validation. Local Whisper checks recognized every listed critical number and the complete numeric occurrence counts. This is an automated cross-check, not subjective listening approval.

## Improvements made during this batch

- Rewrote slash-separated Sacred Arrow stun levels into explicit level-by-level speech.
- Read negative slow/reduction modifiers as clear reductions while preserving their magnitudes.
- Improved Sacred Arrow’s final creep sentence after the first recognizer struggled with it.
- Replaced Bloodstone’s fragmented heading-heavy phrasing with flowing sentences. Original-speed pacing improved from about 90 to 125 words per minute; all gameplay numbers stayed unchanged.
- Kept the original voice and default speed; added two optional faster comparisons instead of changing the app-wide speed.

## Reproduce

```powershell
node scripts/prepare-learning-audio-samples.mjs
python scripts/generate-learning-audio-samples.py
python scripts/validate-learning-audio-samples.py
& D:/conda/envs/whisperx/python.exe -u scripts/transcribe-learning-audio-samples.py
node scripts/build-learning-audio-review.mjs
```

Generation requires Python `edge-tts` (used: 7.3.1) and internet; technical checks use `ffmpeg`/`ffprobe`. Optional local ASR uses `faster-whisper` (working environment: 1.1.0) and a cached base model, with a cached small model for cross-checks. No model download is performed by the ASR script. The general Conda environment had an OpenMP conflict; the existing `whisperx` environment successfully ran the local checks.

Sample promotion and the remaining changed-source recordings remain separate work. Hearing the auditions is the next quality check; the application’s existing files are intact.
