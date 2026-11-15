# DotaPad AI recording library

The learning page originally used Windows speech synthesis at a reduced rate of 0.85. Its pronunciation depended on the installed system voice. The page now uses the author's existing AI-generated MP3s from the Dota 2 bilingual lexicon, copied without re-encoding and played at their original speed.

## Coverage

| Subject | Bundled recordings | Content |
| --- | ---: | --- |
| Heroes | 127 | Hero biographies, labelled “Hero story” |
| Abilities | 734 | Ability name and explanation |
| Items | 244 | Item name and explanation |
| Expressions | 41 | Team communication expressions |
| Total | 1,146 | 148,686,048 bytes, approximately 142 MiB |

There are 164 current item lessons without a matching recording. Some are newer items, internal or older entries in the official feed, or items without recordings in the source library. They display “No recording yet.” The app does not silently substitute a system voice.

## Playback

- Click the recording button in a lesson, after a quiz answer, or in a mistake summary. Click again to stop.
- Only one recording plays at a time.
- Playback stops when switching Settings pages, changing library filters, advancing a question, rebuilding the displayed library or closing the learning document.
- Playback is local and requires no AI credentials or internet access.
- These recordings are archived learning material, not verified readings of the current patch. The source project's audio version is `20260329_v4`; that version label is not proof of the content or generation date of each individual file. Changes to current lesson text do not automatically regenerate the recordings.
- Hero biographies differ from the short hero summary shown on the card. Their button is labelled accordingly.

## Importing assets

Default source: `D:\Projects\dota-2-bilingual-lexicon\public\audio`.

```powershell
npm run learning:import-audio
# Or point at another copy of that public audio directory:
node scripts/import-learning-audio.mjs "D:\path\to\public\audio"
```

The importer reads the learning catalog and matches files by subject, English name, hero folder, and the bilingual project's canonical and legacy apostrophe conventions. It copies matched files into `src/renderer/assets/learning-audio/` and writes `src/learning/audio-manifest.json`. It does not modify the reference project or generate new audio. Re-importing does not delete unused previous assets; review changes and remove obsolete recordings explicitly when maintaining the catalog.

The manifest maps stable lesson IDs to local files and records the original relative filenames, byte counts, import time and missing lessons. When a refreshed lesson has a different name, it is treated as unmatched until reviewed and re-imported. An unchanged name can still have outdated mechanics, so the archive note remains visible.

## Verification

- All 1,146 imported files were checked against their source SHA-256 hashes.
- Automated tests check file presence, size, MP3 headers, coverage, name mapping and player state transitions.
- Muted Electron checks decode representative hero, ability, item and expression recordings and exercise actual playback controls.
- The unpacked Windows preview includes the recordings inside `resources/app.asar`.
- The complete desktop smoke test passed against both the source build and packaged preview, exercising actual muted playback from the app archive.
- No claim is made that the recording transcripts match all current game numbers. Regenerating stale descriptions is a separate content task.
