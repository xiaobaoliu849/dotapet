# DotaPad learning progress

## 2026-11-15 — Initial implementation

- Located the local bilingual lexicon and inspected its public curriculum exports.
- Imported 1,011 initial hero, ability, item and phrase lessons as an offline fallback.
- Built the isolated learning sidebar page, bilingual browsing, search and topic filters.
- Added system English pronunciation, saved words, quizzes in both directions and spaced review.
- Added atomic local progress persistence and exact-document IPC checks.
- Verified the live Valve endpoint formats and implemented an official bilingual updater and maintainer command.
- First live refresh exposed unnamed internal items in Valve's item list. Added explicit omission metadata and restarted the refresh. The fallback catalog was preserved.
- Added a detailed product brief, phased implementation plan, architecture, acceptance criteria and later teaching work.
- Automated suite: **243 tests passed, 0 failed** before final live snapshot refresh.
- Initial sandboxed Electron launch exited before rendering; rerunning the isolated smoke test with desktop execution permission.

Final snapshot and Electron verification results follow.

### Verified snapshot and desktop behavior

- Successfully fetched official bilingual data on **2026-11-15 at 14:41 China time**.
- Final catalog: **1,310 lessons = 127 heroes + 734 abilities + 408 items + 41 expressions**.
- Explicitly omitted seven unnamed internal items. Recipes are excluded. The feed does not verify a patch number.
- Some descriptions retain unresolved value placeholders when the source does not supply their values; mechanics are never guessed.
- Real Electron learning smoke passed: search, bookmarks, quiz submission, saved progress, pet survival and narrow-window layout.
- Full desktop smoke passed, covering existing voice, appearance, phrases, onboarding and updates alongside learning.
- English interface smoke passed, including the new page. Updated the existing keyboard smoke's expected first destination to match the new sidebar order.
- Inspected wide and narrow learning screenshots. No horizontal overflow at minimum Settings width.
- Added updater regression coverage for live-shaped localization joins, omitted internal records and failed fetch retries.
- Learning controls currently use Chinese for the Chinese interface and English for other interface languages; lesson material is intentionally bilingual. Sidebar labels include English, Russian and Ukrainian.
- Final automated suite: **245 tests passed, 0 failed**. All eight learning-specific regression tests passed.
- Russian and Ukrainian interface smoke runs passed alongside English.

### Review and publication

Changes are split into separate commits as requested: catalog/update foundation; Settings workspace and tests; documentation and screenshots. Publication branch: `codex/dotapad-bilingual-learning` in `xiaobaoliu849/dotapet`. No default-branch merge or installer release is included.

To try the source build, run `npm start`, open Settings with **Alt+S**, then choose **Dota English / 刀塔英语学堂**. Existing installed builds need a later package/release to receive these changes.

Verified preview artifacts: [wide layout](images/learning-wide.png) and [narrow layout](images/learning-narrow.png).

### Next teaching iteration

Add original expression explanations and examples, typed/cloze questions and a patch comparison view. Innates, facets, talents and upgrade-specific descriptions need dedicated coverage. Add a cancel control for long refreshes and broaden refresh failure tests before expanding automatic update behavior. Daily sessions and saved-only practice are implemented below.

## 2026-11-15 — Daily sessions and saved-word practice

- Added 5- and 10-lesson sessions using the current topic, language direction and search filters.
- Added a saved-words-only collection and a direct **Practice my saved words** action from the wordbook.
- Due mistakes are selected first, followed by other due reviews and unseen words. Future reviews remain scheduled. Sessions can be shorter when fewer eligible words exist.
- Added a progress bar, per-session counts, local-day completed-session totals, a completion summary and a bilingual mistake list with pronunciation and bookmark actions.
- Starting or advancing a session moves keyboard focus and scrolling to its question or summary.
- Unfinished sessions resume after closing Settings, reloading the learning page or restarting the controller. Active session options remain fixed while studying.
- Moved progress into atomic `learning-state.json` writes alongside the session cursor, preferences and the last 180 completed-session summaries. Legacy bookmarks and schedules migrate automatically; the legacy file is retained.
- Answer submission validates the current session, lesson and selected option in main. Duplicate submissions do not increment attempts or completion history twice. A failed disk write changes neither in-memory progress nor the session cursor.
- Session questions keep their lesson snapshots so refreshing the catalog does not replace an ongoing quiz.
- Validation: **252 automated tests passed, 0 failed**, including all 15 learning tests. The English Settings language check passed.
- Real Electron smoke passed saved-only practice, a five-question daily session, a wrong answer, reload recovery, persisted history, mistake summary and narrow-window overflow checks. The desktop companion remains alive throughout.
- Reviewed the screenshots and improved focus/scrolling after the first visual check; final verification and preview artifacts accompany this iteration.

User instructions: [Daily practice guide](DOTAPAD_DAILY_PRACTICE.md). Publication continues on `codex/dotapad-bilingual-learning`, with separate planner, workspace and documentation commits. No installer release or default-branch merge is included.

## 2026-11-15 — Reuse the existing AI-generated MP3 library

- The user reported unnatural pronunciation. The first implementation used the Windows system voice at 0.85 speed; it did not reuse the existing bilingual project's recordings.
- Inspected `D:\Projects\dota-2-bilingual-lexicon\public\audio`, the original audio button, generation scripts and the public audio version configuration.
- Imported **1,146 matching MP3 recordings**: 127 hero biographies, 734 ability recordings, 244 items and 41 expressions. All imported files match the source SHA-256 hashes exactly.
- Bundled audio occupies **148,686,048 bytes** (about 142 MiB). Files are copied unchanged and played at normal speed, without an AI key, network request or automatic system-voice fallback.
- Mapped recordings by stable lesson ID, hero context and canonical/legacy filenames. The manifest records 164 item lessons without a matching recording; the UI marks them **No recording yet**. Renamed lessons do not silently inherit an old recording by ID.
- Added recording controls to the lesson library, quiz answer explanations and the mistake summary. Clicking again stops playback. Switching pages, filtering, advancing a question and closing the document release playback.
- Hero recordings are explicitly labelled **Hero story**; recordings are not presented as name-only pronunciation. The page identifies archived audio wording that may differ from current game descriptions.
- Added playback tests for normal speed, toggling, completion, errors, pending-play cancellation and imported-asset integrity. Full automated suite: **257 passed, 0 failed**. English interface check passed.
- The desktop smoke checks actual MP3 metadata for all four lesson kinds and exercises a visible ability's MP3 play/stop and navigation behavior with audio muted.
- Built an unpacked Windows preview under `release/learning-audio-preview/win-unpacked`. Verified all 1,146 MP3 files and the audio manifest are included in `app.asar`.
- Full source and packaged-preview desktop smoke tests both passed, including actual muted MP3 playback from source files and from `app.asar`, normal speed, stop toggling and stopping when leaving the learning page.

Maintenance details and limitations: [AI audio library](DOTAPAD_AUDIO.md).

## 2026-11-15 — Current-content audit and selective audio updates

- Refreshed the complete official English/Chinese catalog at 15:31 China time and preserved the previous snapshot. Added numeric balance fields and hero biographies for meaningful future comparisons.
- Fixed description interpolation to use exact special-value names before fallback aliases, resolve supplied built-in duration/channel values and avoid doubled percent markers.
- Imported public archived candidate scripts and comparable numeric facts, including innate abilities that were stored separately in the older reference export. No reference files or MP3s were changed.
- Audited all 1,310 lessons: **884 baseline matches; 100 matching main descriptions with extra archive context; 88 changed candidate scripts (45 abilities, 43 items); 65 stat-only sources needing a narration template; 1 unresolved-current-source case; 8 without a comparable transcript; 164 without recordings**.
- Found 323 records with differences in shared numeric fields. Text and numeric counts overlap and are not patch-specific change totals.
- Corrected an audit false positive: archived item scripts often include notes and attributes omitted from the current main-description field. Those 100 cases are now separate from changed wording.
- Prepared 200 unreviewed synthesis candidates (88 changed scripts and 112 usable missing-recording scripts). Excluded stat-only sources needing a narration template, unresolved source values and extra-context-only cases. Item availability requires review; the official feed includes historical/internal entries.
- Added per-recording archive labels distinguishing changed wording, extra notes and unresolved values. MP3s remain playable as archived material.
- Successful refreshes now save the previous snapshot and a change report; tests verify that a failed fetch preserves current data and that ongoing daily sessions survive refreshes.
- Checked the 20 most recent official Steam announcements: latest gameplay announcement found was 7.41f (September 15). No confirmed next-major-patch date found in those posts; no forecast or new automation was created.
- Validation: **264 automated tests passed, 0 failed**, plus the English Settings check. Desktop verification covers the changed/extra-context labels, MP3 playback, saved words and daily sessions.
- No MP3 synthesis, transcript certification or mass replacement was performed. This is an audit of archived input candidates and current official data; full listening/ASR review remains separate.

Recommendation and review workflow: [Content update policy](DOTAPAD_CONTENT_UPDATE_POLICY.md). Machine-readable evidence and the review queue are under `docs/audits/`. Changes continue as separate commits on the existing feature branch.

## 2026-11-15 — First current-content Jenny audition batch

- Confirmed the original scripts use `edge-tts` with `en-US-JennyNeural`; verified the voice is currently available. No API key was needed or used.
- Reviewed eight changed-source scripts against live official descriptions: Persecutor, Marksmanship, Sacred Arrow, Necromastery, Disperser, Shiva's Guard, Manta Style and Bloodstone.
- For the four items, checked the current official late-game recommendation flags and positive costs. This is feed evidence, not an independent in-game shop check.
- Generated eight original-speed audition MP3s and two optional +10% pace comparisons for Manta Style and Bloodstone. Existing app recordings remain unchanged.
- Recorded exact spoken scripts, source text, both text hashes, audio hashes, generation time, source-check time, voice and versioned synthesis settings. Listening approval and promotion remain false.
- Decoded all ten MP3 files with FFmpeg and measured duration, audio levels and approximate pacing. All decoded fully; none had peaks near full scale.
- A local cached Whisper-base pass recognized the critical numeric phrases and complete numeric occurrence counts in every final sample. A cached Whisper-small model cross-checked Sacred Arrow and both Bloodstone versions. These are automated checks, not subjective listening approval.
- The first pass flagged Sacred Arrow's final sentence and Bloodstone's heading-heavy phrasing. Reworded those scripts for clarity and regenerated only the affected auditions. Bloodstone's original-speed pacing improved from about 90 to 125 words/minute; the updated script retains all current gameplay numbers.
- The general Conda ASR environment had an OpenMP conflict. The existing isolated `whisperx` environment ran the cached models successfully; no workaround to suppress the conflict and no new model download was used.
- Added an offline A/B comparison page with the original archives, new samples, optional faster variants, scripts and official source links: [Listen and compare](audio-samples/REVIEW.html).
- Added offline checks for source/script/audio hashes, successful media validation, ASR number checks and unchanged original app assets. Final automated suite: **267 tests passed, 0 failed**. All ten samples passed complete decoding and ASR numeric-occurrence checks; subjective listening approval remains pending.

The original regeneration queue remains an audit candidate report. Source-reviewed audition execution is tracked separately in `docs/audio-samples/batch-plan.json` and the batch manifest. The auditions are not installed as current lesson audio yet.

## 2026-11-16 — Visual item learning and practice usability

- Located and reviewed the reference project at `D:\Projects\dota-2-bilingual-lexicon` and the earlier scraper at `D:\DOTA2Scraper`.
- Bundled and decoded all 408 item PNGs for offline cards and quiz pictures, with per-image sources/hashes and readable failure placeholders.
- Added bilingual match sentences, vocabulary hints, common item aliases and a contextual five-lesson entry point.
- Fixed hidden item pagination, unseen words counted as overdue, saved spoken phrases omitted from wordbooks/quizzes, duplicate mastery totals and next-session controls hidden behind completed summaries.
- Kept the dated lesson descriptions and archived audio. Current-shop availability and reviewed short pronunciation clips remain separate follow-up work.
- Validation after integration with the latest GitHub changes: 288 automated tests passed; full Electron desktop smoke passed. Legacy cached image URLs and CDN mirrors remain supported, and upstream item-image tests now run in the default suite. All 408 local image files decoded successfully in Chromium.
- Findings, completed steps, screenshots and remaining priorities: [Intuitive learning plan](DOTAPAD_INTUITIVE_LEARNING_PLAN.md).

## 2026-11-16 — Phase 2: guided beginner path

- Converted the plan into a tracked five-phase roadmap with explicit status, acceptance criteria and checklists. Phases 1 and 2 are complete; phase 3 (short pronunciation and match-sentence recordings) is next.
- Verified ten beginner item identities against official Chinese shop categories and Valve's item list. Stored dated source URLs, response hashes and the explicit limitation that no running-game-client check was performed.
- Added two ordered five-item units on a default Start here page. Each item receives a picture, bilingual name, short meaning and match sentence before an English recall quiz restricted to that unit.
- Saved learning-card checkpoints separately from quiz attempts. Validated learning-step order, retries, foreign callers and failed writes; learning cards resume after reload without inflating accuracy.
- Preserved review dates and bookmarks. The main action routes to the next ready unit rather than repeating a unit whose reviews are scheduled for later.
- Validation: 292 automated tests, full Electron desktop checks and English/Russian/Ukrainian settings checks passed, including local images, learned-card recovery, quizzes, next-unit routing and narrow layout. Screenshots and the next task list are linked from the roadmap. Changes are separated into curriculum, saved learning checkpoints, interface and documentation commits.

## 2026-11-19 — Dota 2 Patch 7.42 bilingual catalog, artwork & audio update

- Confirmed **Dota 2 Patch 7.42 ("7.42 Gameplay Update")**, published `2026-11-18T20:00:46Z`, via Valve's official Steam Community Announcements API and `patchnoteslist` API. Updated `docs/audits/official-announcement-check.json`.
- Crawled the complete bilingual catalog (`english` and `schinese`) from `https://www.dota2.com/datafeed/` at `2026-11-19T05:04:28.926Z`: **1,329 lessons = 127 heroes + 736 abilities + 425 items + 41 expressions** (7 unnamed internal items explicitly omitted).
- Diff against the 2026-11-15 snapshot: **26 added lessons** (9 new abilities and 17 new items, including the 6 new shop items Caduceus / 双蛇杖, Sabatons of Mordiggian / 莫尔迪基安的护足, Bloodslinger, Ristul's Devotion, Starforge, and Skypiercer), **7 removed abilities**, and **396 changed lessons**. Verified all 10 starter-path shop items via `npm run learning:check-starter-shop`.
- Noted official Valve feed localization gaps: several brand-new 7.42 items still return English names/descriptions in Valve's `schinese` feed (including on `dota2.com.cn`), and `Skypiercer` Chinese text retains Valve's `%disarm_melee%` token; official feed text is preserved verbatim without fabricated translations.
- Bundled and verified **421/425 item PNGs** via `npm run learning:import-images` and `npm run learning:verify-images`. All 13 active Patch 7.42 items downloaded valid PNGs; 4 non-patch-notes feed items (`item:1881`, `item:1883`, `item:1884`, `item:1949`) are recorded as explicit HTTP 404 artwork gaps.
- Synthesized and `ffmpeg`/`ffprobe`-validated **26 new `en-US-JennyNeural` MP3 recordings** (all 9 new abilities + all 17 new items) with full script/audio SHA-256 provenance via `scripts/generate-patch-audio.py`, and pruned the 7 removed abilities. Total bundled library: **1,165 recordings**, **164** legacy item gaps (100% coverage of heroes, abilities, expressions, and all Patch 7.42 items).
- Updated `src/learning/contentAudit.js` and `src/renderer/learning.js` to recognize verified generated scripts (`current-verified`) and name-only sub-abilities (`Heel, Armageddon`), while keeping all 8 original `jenny-batch-1` archive files untouched.
- Re-ran `npm run learning:audit`: **784 baseline-matches, 197 baseline-changed, 84 baseline-extra-context, 26 current-verified, 65 needs-stats-template, 164 missing, 8 unknown-transcript, 1 unresolved-current** (total 1,329).
- Validation: **292 automated tests passed, 0 failed** (`npm test`), **421 item PNGs verified** (`npm run learning:verify-images`), and real Electron desktop smoke tests (`npm run smoke` and `npm run smoke:en`) passed.

## 2026-11-19 — Official Dota 2 Shop Item Grid redesign

- Inspected the official Dota 2 items website (`dota2.com.cn/items`) and synced its official shop category feed (`https://www.dota2.com.cn/itemscategory/json`) into an offline, hash-verified manifest (`src/learning/item-shop-categories.json`, refreshable via `npm run learning:sync-shop`).
- Replaced the flat 408-card paginated Items list with a recognizable Dota 2 Shop Grid (`src/learning/itemShop.js`, `src/renderer/learning.html`, `src/renderer/learning.js`, `src/renderer/learning.css`):
  - **Shop (商店物品, 183):** Two-shelf official layout with **Basics** (5 columns: Consumables, Attributes, Equipment, Misc, Secret Shop) and **Upgrades** (6 columns: Accessories, Support, Magical, Armor, Weapons, Artifacts), sorted by gold cost ascending, with category jump chips, one-click shelf jumps, and a `Grid / Names` view toggle.
  - **Neutral (中立物品, 62):** Synced directly to Valve's live `item_neutral_tier` API for **Patch 7.42** — 4 official Neutral Tiers (`0:00`, `15:00`, `30:00`, `50:00` peak tier where surviving Tier 5 artifacts moved) plus **19 active Neutral Enchantments**, with an inline 7.42 note explaining the 5→4 tier merge.
  - **Special & Archive (肉山与历史, 163):** Cleanly separates Roshan & Map drops (Aegis, Cheese, Refresher Shard, Healing Lotus), upgrade variants, and cycled-out/historical entries (such as Stygian Desolator and Spider Legs) so all 408 catalog items remain accessible without cluttering the live shop.
  - **Instant search, hover previews & zero-scroll Floating Study Card:** Ranked cross-catalog search supports English names, Chinese names, 65+ player aliases (`bkb`, `跳刀`, `冰甲`, `先锋盾`, `ac`, `mkb`, `羊刀`, etc.), and category names; hovering any shop icon shows a dark-forest preview card, clicking any item anywhere opens a centered Floating Study Card over a frosted scrim with **zero scroll jump** (`← / → / Esc` navigation, AI audio, bookmarks, and focused practice), while single-match search renders inline without blocking the search box.
  - **Complete bilingual item stats, notes & introductions:** Synced official English/Chinese `special_values` stat bonuses, gameplay notes, and lore introductions from Valve's `datafeed/itemdata` API (`src/learning/item-details.json`, refreshable via `npm run learning:sync-details`, resolved via `src/learning/itemDetails.js`) so all 116 stat-only items (such as Cloak, Platemail, Ogre Axe, and Neutral Enchantments) display full bilingual stats, notes, and lore instead of blank descriptions, plus live stat chips inside the hover preview.
- Validation: **297 automated tests passed, 0 failed** (including `tests/test_learning_shop.js` asserting 100% Shop/Neutral detail coverage and zero unresolved tokens), English UI smoke (`npm run smoke:en`) passed, and full Electron desktop smoke (`npm run smoke`) passed with all 408 offline PNGs decoded, bottom-item zero-scroll-jump regression check, Cloak detail verification, and zero horizontal overflow at wide (`1060×820`) and narrow (`620×730`) sizes.
- Previews: [Shop Basics](images/learning-items.png), [Shop Upgrades & Hover Preview](images/learning-items-upgrades.png), [Floating Study Card](images/learning-items-modal.png), [Stat-Only Item Details (Cloak)](images/learning-items-cloak.png), [Neutral Tiers (7.42)](images/learning-items-neutral.png), [Search & Study Inspector](images/learning-items-inspector.png), [Narrow Layout](images/learning-items-narrow.png).

## 2026-11-20 — Patch 7.42 version marker, interactive "What Changed" explorer & inline diffs

- Recorded verified official **Patch 7.42** (`patch: "7.42"`, `patchDate: "2026-11-18T20:00:46.000Z"`) in `src/learning/catalog.json` and updated `src/learning/update.js` (`fetchLatestPatch`) so future live Valve refreshes automatically query `patchnoteslist` instead of leaving `patch: null`.
- Built `src/learning/patchChanges.js`, `scripts/build-patch-changes.mjs` (`npm run learning:build-patch-changes`), and the bundled offline manifest `src/learning/patch-changes.json` (served via `learningController.js` and regenerated dynamically on live diff refreshes while preserving current markers on zero-change refreshes). Deduplicates parallel Valve keys (`cooldowns` / `AbilityCooldown`, `mana_costs` / `AbilityManaCost`, etc.), separates base/Shard/Scepter diffs, maps 100+ Dota mechanics fields to bilingual labels, and preserves all 7 removed abilities with their parent heroes.
- Added the live-dot **`● Patch 7.42 · What's new`** (`● 7.42 最新 · 看更新`) pill in the Learning topbar and updated the source footer to show verified **Patch 7.42 · Latest** instead of "Patch number unverified".
- Built the floating **Patch 7.42 Explorer Modal** (`Highlights`, `Changed Items`, `Changed Heroes` tabs) with clickable KPI tiles, visual cards for all 6 new Shop items, 5 new Neutral items, 9 new Hero abilities, Neutral 4-tier rework shortcut, 7 removed abilities, per-realm changed item diffs, and 118 affected heroes — each jumping directly to the corresponding Study Card or Hero Detail view.
- Added **`✨ 7.42`** quick filters and visual markers across **Items** (emerald `NEW` micro-badges on the 6 new shop items, clean amber corner dots on changed items, dark-forest hover tooltip diffs, and full before → after diff boxes + collapsible `7.41f` wording comparison inside Study Cards), **Heroes** (hero wall `7.42 NEW` / change-count chips, Hero Detail clickable 7.42 jump pill, `✨ 7.42 changes only` toggle sorting new abilities first, inline ability diff boxes, and a muted Removed Abilities card), and **Explore**.
- Visually inspected all rendered Electron desktop screenshots across Chinese, English, wide (`1060×820`), and narrow (`620×730`) sizes and iterated to fix modal footer spacing, compact category pill sizing, duplicate EN-only item subtitles, muted 0-match filtered Shop columns, Hero Detail new-first ordering, and Chinese item/ability stat labels.
- Validation: **305 automated tests passed, 0 failed** (`npm test`, including `tests/test_learning_patch_changes.js`), full Electron desktop smoke (`npm run smoke` with `src/main/learningPatchSmoke.js`) passed, and English UI i18n smoke (`npm run smoke:en`) passed with zero stray Chinese characters.
- Previews: [Patch 7.42 Explorer Highlights](images/learning-patch-modal-highlights.png), [Patch 7.42 Changed Items](images/learning-patch-modal-items.png), [Patch 7.42 New Item Audio & Official Chinese (Starforge)](images/learning-patch-item-new.png), [Shop Filtered to 7.42](images/learning-patch-shop-filtered.png), [Hover Tooltip 7.42 Diff](images/learning-patch-hover-diff.png), [Item Study Card 7.42 Diff](images/learning-patch-item-changed.png), [Hero Detail 7.42 Changes](images/learning-patch-hero-changes.png).

### Official Chinese localizations & bundled Patch 7.42 AI audio

- Verified and applied official `dota2.com.cn` Patch 7.42 Chinese names and verbatim descriptions (`220541.html` / `220540.html`) for all shipped new items and hero abilities: **Bloodslinger / 血腥投带**, **Ristul's Devotion / 瑞斯图尔的奉献**, **Starforge / 锻星炉**, **Skypiercer / 破天之矛** (also resolving Valve's `%disarm_melee%` token), **Balmhook / 镇痛之钩**, **Vile Phial / 邪恶药瓶**, **Greater Horn of Battle / 大战斗号角** (classified under Roshan & Map drops), **Pack Hunter / 狼群猎手**, plus official Chinese descriptions for **Red Ledger / 悬红**, **Brick / 板砖**, **Helm of the Hivemind / 虫巢思维头盔**, and **Fling / 摔扔**. Added bilingual match sentences and player nicknames (`大榴弹`, `大祭品`, `大相位`, `大天堂`, `大陨星锤`, `大战斗号角`) to `src/learning/itemCoaching.js`.
- Bundled all **26 SHA-256-verified `en-US-JennyNeural` Patch 7.42 MP3 recordings** (all 17 new items + 9 new abilities, 2.72 MB total, reading item/ability names and full English descriptions) directly into `src/renderer/assets/learning-audio/`, cleared `localOnly: true` from `src/learning/audio-manifest.json` and `scripts/generate-patch-audio.py`, and removed their `.gitignore` exclusions so GitHub builds play all new Patch 7.42 audio out of the box.
- Validation: **306 automated tests passed, 0 failed** (`npm test`), full Electron desktop smoke (`npm run smoke`) passed verifying live `▶ AI 录音` controls and official Chinese names, and English UI smoke (`npm run smoke:en`) passed.

## 2026-11-21 — Lesson reliability, curriculum, and packaging

| Checkpoint | Delivered | Evidence |
| --- | --- | --- |
| Lesson navigation and recovery | Added a direct next-lesson action to the starter summary. Starting and advancing show progress. Failed writes report the error on the open lesson or summary and keep the checkpoint available for retry. | On the original code, blocking the temporary state file caused a guided action to fail silently. The Electron regression checks the visible failure, unchanged saved position, retry, and next-unit routing. |
| Bilingual quiz integrity | Excluded other valid translations from distractors and aligned review and mastery counts with quiz eligibility. Existing bookmarks are still counted. | An offline sweep covered 2,696 questions across 1,348 eligible lessons. Each question had four distinct choices and one valid translation. The two Boots of Travel variants that share `远行鞋` have a regression test. |
| Game connection | Aligned disconnect detection with the 30-second idle game heartbeat. The installer checks whether the GSI config points to the active port. | Regression tests cover an idle game, a stopped heartbeat, an old port with the same prefix, and a misleading URI in a comment. |
| Windows distribution notices | Included the project MIT license and attribution in the Windows package. Release CI checks their hashes. Documented the provenance of Valve art and text and of AI narration. | Built the NSIS installer locally and extracted its payload. The two project files matched the repository by SHA-256. Electron and Chromium notices were present. |

The review covered the lesson renderer and IPC, saved progress, the quiz bank and catalog refresh, GSI startup and traffic, Settings and voice integration, the updater, and the installer pipeline. The full suite passed **312 tests**. The desktop smoke exercised lesson persistence and navigation along with settings, voice mocks, phrase tools, customization, and mocked updates. All three additional Settings language checks passed (English, Russian, and Ukrainian). Development checkpoints are on `codex/dotapad-reliability`.

### Next priorities

| Priority | Work | Completion check |
| --- | --- | --- |
| 1 | Keep verified Chinese localizations through catalog refresh. Reconcile conflicting bilingual mechanics and unresolved placeholders before generating narration. | Maintain patch-scoped source references and tests that preserve reviewed wording for the matching patch and flag changed mechanics. Start with Starforge's differing stun durations and the unresolved descriptions for `ability:5587`, `item:257`, and `item:825`. |
| 2 | Add short pronunciation and match-sentence clips for the ten starter items. Verify narration and script redistribution terms before bundling the clips, and triage the 164 item recording gaps by current shop availability. | Record the source, approved script, listening review, and redistribution basis for each new clip. Verify offline playback. [Starter curriculum roadmap](DOTAPAD_INTUITIVE_LEARNING_PLAN.md#tracked-roadmap) · [Attribution and rights](../NOTICE.md) |
| 3 | Add picture-first and typed recall with reviewed English aliases for the starter items. | A learner can type an accepted alias, see why an answer was accepted or rejected, resume after reload, and keep the existing spaced-review dates. |
| 4 | Make app preference writes atomic and show a retryable error when a save, Settings page load, or GSI listener bind fails. | Inject each failure in tests and verify that preferences survive and the affected action can recover in the desktop UI. |
| 5 | Upgrade the Windows app from Electron 33, which is past end of support. | Verify desktop startup, microphone permissions, encrypted settings, global shortcuts, packaged notices, and updater compatibility on a supported version. [Electron release schedule](https://releases.electronjs.org/schedule) |

For each checkpoint, reproduce the issue or define the expected behavior, make the smallest complete change, run the targeted and shared tests, record the evidence here, and push that checkpoint before starting the next one. Keep release and installer publication separate from development pushes.
