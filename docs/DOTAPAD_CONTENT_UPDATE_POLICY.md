# Keep DotaPad current without regenerating every recording

## Recommendation

Keep bilingual lesson text and balance data current. Keep each recording tied to the exact text it was generated from. Replace recordings only after reviewing a change to the spoken text. Preserve old recordings with archive labels until their replacement is checked.

Do not wait for a predicted major patch. As checked on November 15, 2026, Valve's latest gameplay announcement found in the official Steam announcement feed is [7.41f, published September 15](https://www.dota2.com/newsentry/677383425371407609?l=english). No confirmed next-major-patch date was found in the 20 announcements checked. This is not a claim that there have been no later client hotfixes. See [the source-check record](audits/official-announcement-check.json).

## Completed content audit

Compared the current English and Simplified Chinese official feeds with the public March 29 archive and candidate scripts from the original generation inputs. Refreshed the catalog on November 15, 2026 at 15:31 China time.

| Recording/source comparison | Lessons | What it means |
| --- | ---: | --- |
| Archived candidate matches current narration text | 884 | Text reuse candidate; MP3 transcript remains unverified |
| Current main explanation matches, archive has extra notes/stats | 100 | Review extra context; do not automatically regenerate |
| Archived candidate wording differs | 88 | First review priority: 45 abilities and 43 items |
| Current source has no prose description (stat-only items) | 65 | Build a narration template from verified current attributes |
| Current description has an unresolved source value | 1 | Resolve the source value before preparing a replacement |
| Recording exists, no comparable candidate transcript | 8 | Listen/transcribe before judging freshness |
| No matching recording | 164 | Coverage gap; includes item-feed entries whose current purchase availability needs review |

Separately, 323 lesson records differ in numeric fields captured in both the March and current data. This count overlaps the text classifications. Missing historical fields are not called changes. Numeric differences do not automatically imply that the recording speaks the changed value.

For example, archived Anti-Mage Mana Break data has `percent_damage_per_burn=60`, while the current feed reports 65. Its main description does not contain that number. Persecutor's archived description names a 50% mana threshold while the current description names 60%; that affects its spoken script directly.

The original item scripts sometimes combined attributes, the main description and extra notes. A simple string comparison incorrectly treated those additional notes as stale. The audit now gives them a separate category. Blink Dagger is an example: its main description matches, while the archived script additionally describes self-casting.

**These are comparisons of source data and candidate scripts, not an ASR or listening verification of all MP3s.** The exact original synthesis transcript was not recorded for every asset. No audio was generated, deleted or replaced during this audit.

## Working update process

1. **Check official data weekly and after an announced gameplay update.** This is the recommended maintenance cadence; no scheduled automation has been created. The app's refresh remains explicit and manual.
2. **Fetch the complete bilingual catalog.** Validate localization pairs and retain the last working snapshot if fetching fails. Store source and retrieval time. Record any verified announcement separately; do not infer an exact patch number from the data-feed timestamp.
3. **Compare stable IDs.** Check English text, Chinese text and shared numeric facts. Distinguish language corrections, gameplay changes, new source fields and source coverage differences. The official item list includes historical/internal items; listing alone does not prove current purchasability.
4. **Update lesson text first.** Keep current text available while old recordings remain clearly identified as archives. Retain active-session lesson snapshots and user learning progress.
5. **Review only affected audio scripts.** Prioritize changed spoken mechanics, then new active content. Reuse verified unchanged English recordings after Chinese-only edits or changes to numbers that are not spoken. Resolve remaining placeholders and verify item availability before synthesis.
6. **Generate a small reviewed batch.** Match the established voice, check names, pacing and numbers, then extend to the remaining reviewed changes. A speech-to-text pass can help identify omissions and number errors; it does not replace listening samples.
7. **Publish with exact provenance.** Each new recording should carry `script`, `scriptSha256`, `generatedAt`, voice/provider settings, language, playback rate, source retrieval time and any verified patch annotation. Only mark a track current when its verified script matches the current narration text. Keep the previous file until the replacement passes checks.

After a large patch, run the same process with a larger review queue. Freeze each released catalog as a reproducible snapshot; continue maintaining newer snapshots. Stable vocabulary and everyday expressions do not need a new recording merely because a patch was released.

## Commands and evidence

```powershell
npm run learning:update
npm run learning:audit
# Rebuild the archived candidate baseline only when intentionally reviewing the reference inputs:
npm run learning:import-baseline
```

- [Human-readable audit](audits/CONTENT_AUDIT.md)
- [Per-lesson candidate script comparison](audits/latest-content-audit.json)
- [Historical numeric and bilingual comparison](audits/historical-data-comparison.json)
- [Regeneration review queue](audits/audio-regeneration-queue.json)

The queue contains 200 candidate scripts: 88 changed-source candidates and 112 missing-recording candidates with usable current descriptions. Every entry starts unreviewed. Missing items require an active-item availability check; stat-only descriptions needing a template, unresolved values and extra-context-only differences are not queued for automatic replacement.

An initial set of eight changed-source lessons has now been source-reviewed and synthesized as separate auditions, with two optional faster comparisons. [Listen to the batch](audio-samples/REVIEW.html) and see its [provenance and checks](audio-samples/README.md). No API key was needed for the original Jenny/Edge TTS route. These samples remain separate from installed recordings; the audit queue itself is not a synthesis-approval ledger.

App refreshes now preserve `learning-catalog.previous.json` and `learning-catalog-changes.json` in the user's local data directory. Maintainer refreshes preserve the previous snapshot and differences under `docs/audits`. The new catalog records balance facts and hero biographies as well as lesson prose. The normal ability feed also includes innate entries; their presence does not require a separate request or prove that they are newly introduced abilities.
