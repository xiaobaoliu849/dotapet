# Dota English usability review and implementation

Reviewed and implemented on November 16, 2026.

## Goal

Make an unfamiliar English item name connect to something the player already recognizes: its picture, Chinese name, common nickname and a short sentence they can say in a match. Follow that with a small, resumable recall session.

## Tracked roadmap

Work proceeds one phase at a time. Each phase ends with a usable result, relevant automated and desktop checks, and an update here with completed tasks and evidence. Later phases stay pending until their own completion criteria are met.

| Phase | Status | Deliverable | Completion criteria |
|---|---|---|---|
| 1. Reliable visual learning | Complete, pushed | Offline item images, aliases, wordbooks and practice navigation | 408 images decode; tests and desktop checks pass |
| 2. Guided beginner path | Complete | Two small lessons covering ten familiar shop items; learn before recall | Dated shop-source evidence; explicit learning step; focused quizzes; pause/resume; no unrelated items; responsive UI |
| 3. Short pronunciation and speaking | Next; not started | Separate buttons for a name and a useful match sentence | Exact scripts recorded; clips decode; pronunciation reviewed; archive audio remains clearly labeled |
| 4. Active English recall | Pending | Picture-first recall and typed English answers | Accepted aliases, clear feedback, saved progress and tested keyboard use |
| 5. Expand and refine | Pending | More scenarios and reviewed bilingual explanation segments | Consistent content review and a usability pass through the complete beginner flow |

### Phase 2 checklist

- [x] Verify the ten selected items against a dated official shop source; record limitations.
- [x] Create two ordered five-item units with a clear practical purpose.
- [x] Show each picture, English/Chinese name, short meaning and match sentence before testing.
- [x] Keep the quiz restricted to the selected unit; preserve due-review scheduling.
- [x] Resume an unfinished learning or quiz step without losing saved words.
- [x] Verify with focused tests and real Electron screenshots; record the result here.

Phase 2 is an English-learning sequence, not a recommended in-game purchase order. Full current-shop classification of all 408 reference entries remains separate from verifying this starter subset.

### Phase 2 result — November 16, 2026

- The default **Start here** page offers **Stay in lane** (Tango, Healing Salve, Magic Stick, Boots of Speed, Town Portal Scroll) and **See and move together** (Observer Ward, Sentry Ward, Dust of Appearance, Smoke of Deceit, Blink Dagger).
- Item identities were matched in both the official Chinese shop-category list and Valve's item feed. The dated [source evidence](../src/learning/starter-shop-evidence.json) records source URLs and response hashes. This is website-listing evidence; no game-client verification is claimed. Recheck with `npm run learning:check-starter-shop`.
- Five compact learning cards precede English recall. Each card combines a local picture, bilingual name/meaning, match sentence and bookmark. The server rejects quiz answers before the learning cards are complete.
- Reading checkpoints save independently from quiz accuracy. Reopening the page resumes the next unread card. Quiz answers still use the existing atomic session/progress save and spaced-review dates.
- The next action advances to the next unit with words ready to learn/review. Neither the current unit nor its distractors draw unrelated words from the full catalog. Future reviews stay scheduled.
- **Validation:** 292 automated tests passed. Full Electron checks passed, including ten starter pictures, learn-before-recall, card bookmarks, reload recovery, focused English quizzes, next-unit routing and narrow layout. Relevant focused tests were rerun after adding item-identity guards.
- Changes are grouped into separate curriculum/evidence, saved learning checkpoints, guided interface, and roadmap/documentation commits. English, Russian and Ukrainian settings checks also passed.
- Previews: [starter units](images/learning-starter.png), [learning card](images/learning-guide.png), [narrow units](images/learning-starter-narrow.png).

### Phase 3 task list — next

1. Freeze the ten starter names and ten match-sentence scripts with source/script hashes.
2. Prepare **20 separate short English clips**: one name clip and one sentence clip per item. Keep the existing long archive recordings separate.
3. Decode every clip, check duration/silence and compare recognized speech against the exact script. Record review status explicitly; automated checks do not certify subjective pronunciation quality.
4. Add **Hear the name** and **Hear the sentence** controls to learning cards, with one-at-a-time playback, clear stop/error states and keyboard labels.
5. Verify offline playback, navigation stopping audio, saved-step recovery and narrow layout; update this roadmap with the completed evidence.

After phase 3, phase 4 adds an English typing/picture-first exercise with accepted item aliases and a clear transition from recognition to recall. Phase 5 expands the same reviewed pattern to more match situations.

## Local sources inspected

- `D:\Projects\dota-2-bilingual-lexicon`: the reference bilingual application. Its public official item export has 236 records; its item catalog provides Steam image URLs. DotaPet already imports its AI recordings. Reference files were read only.
- `D:\DOTA2Scraper`: earlier hero/item scraping scripts, JSON progress and Excel exports. This remains a reference source; no spreadsheet content was merged into the newer lessons.
- DotaPet's bundled Valve catalog: 1,310 lessons including 408 items, fetched November 15, 2026. The renderer also has 25 curated spoken callouts which previously did not join the saved/review collection.
- [Valve item list](https://www.dota2.com/datafeed/itemlist?language=english): official internal item names used to identify image filenames. Downloaded images use Valve's Steam CDN. The lesson descriptions and archived recordings were not refreshed by this change.

## Findings and completed steps

1. **Pictures were absent.** Item cards never created image elements and the lesson model dropped internal asset names. Added a source/hash manifest and bundled all 408 item PNGs (13,303,769 bytes, approximately 12.7 MiB). Cards and item quizzes use local images. Catalog refresh retains official internal names, allowing recognized items to keep their local image and new items to try an official URL. Unknown or failed artwork gets a readable placeholder. No filename is guessed from translated text.
2. **The page offered information without a clear practice path.** Added “See it. Read it. Say it. Recall it.” guidance and a five-lesson action that respects the current topic/search or resumes an unfinished session. Item cards now show a bilingual match sentence and up to four vocabulary hints found in their English explanation. Fifteen common items have curated callouts and aliases; other items use a simple possession sentence. Examples avoid patch-sensitive numeric claims.
3. **Familiar names were hard to search.** The shared library/session search now recognizes common aliases such as BKB, TP, 跳刀, 羊刀, dust and smoke. The Items page uses the same search logic as practice.
4. **The progress display was discouraging and inaccurate.** New words counted as “ready to review.” Only previously attempted, due lessons now contribute to that number; the guidance displays new lessons separately.
5. **Some saved words disappeared.** Spoken callouts could be bookmarked but never appeared in My words or saved-only sessions. They now share the same collection, quiz and persistence flow. Mastery totals deduplicate their IDs.
6. **Item browsing stopped at 24 entries.** The shared Load more button was inside a panel hidden on the Items tab. Moved it outside that panel and verified the list grows to 48 entries on the next page.
7. **A completed session hid the next choices.** “Plan another session” now opens the topic/direction/length controls before starting. Saved-word practice opens setup after a previous completed session rather than showing its old summary.

## Validation

- `npm test`: 288 automated tests passed after integration with the latest GitHub changes, including all bundled image signatures/hashes, image identity/path handling, legacy cached image URLs, CDN mirrors, alias search, due counts, spoken-word persistence and collection totals. The upstream item-image tests now run in the default suite.
- `npm run learning:verify-images`: 408 PNGs verified; zero missing artwork entries.
- `npm run smoke`: real Electron/Chromium verification, including decoding every bundled item PNG through local file URLs, rendering cards and quiz cues, error placeholders, aliases, pagination, saved-only sessions, restart/resume, audio playback and responsive layout.
- `npm run smoke -- --lang=en`: English settings language check passed. Fixed a pre-existing Chinese fragment in the English abilities heading identified by that scan.
- Image alt text in an unanswered quiz describes the picture without exposing the English answer.
- Desktop screenshots: [item learning](images/learning-items.png), [narrow layout](images/learning-items-narrow.png).

## Maintenance

Run `npm run learning:import-images -- "D:/Projects/dota-2-bilingual-lexicon"` when intentionally updating artwork. It reads public reference data, fetches the official item list, validates PNG signatures/dimensions and records per-file source URLs and SHA256 hashes. Then run `npm run learning:verify-images`, `npm test` and `npm run smoke`. The image assets live under `src`, so the existing installer file rules include them.

## Follow-up priorities

1. **Broader current-shop curation:** phase 2 verifies the ten-item starter subset using two official sources. Classification of the other reference entries remains pending; verified artwork alone does not establish current availability.
2. **Short pronunciation clips:** existing buttons play long archived explanations or biographies. Add separately reviewed name/callout clips and optional sentence playback. The current archived audio warnings remain relevant; image verification does not certify audio transcripts.
3. **Production practice:** introduce a typed English answer or a picture-first recall mode after recognition practice. Current quizzes still test name translation; saying the answer aloud is voluntary and is not automatically graded.
4. **More editorial coverage:** extend the curated callouts/aliases and annotate short English/Chinese explanation segments after language review. Avoid splitting machine-generated descriptions into apparently aligned sentences without checking their meaning.
