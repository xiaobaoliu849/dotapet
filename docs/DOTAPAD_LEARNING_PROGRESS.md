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

## 2026-11-19 — Official Dota 2 Shop Item Grid redesign

- Inspected the official Dota 2 items website (`dota2.com.cn/items`) and synced its official shop category feed (`https://www.dota2.com.cn/itemscategory/json`) into an offline, hash-verified manifest (`src/learning/item-shop-categories.json`, refreshable via `npm run learning:sync-shop`).
- Replaced the flat 408-card paginated Items list with a recognizable Dota 2 Shop Grid (`src/learning/itemShop.js`, `src/renderer/learning.html`, `src/renderer/learning.js`, `src/renderer/learning.css`):
  - **Shop (商店物品, 183):** Two-shelf official layout with **Basics** (5 columns: Consumables, Attributes, Equipment, Misc, Secret Shop) and **Upgrades** (6 columns: Accessories, Support, Magical, Armor, Weapons, Artifacts), sorted by gold cost ascending, with category jump chips, one-click shelf jumps, and a `Grid / Names` view toggle.
  - **Neutral (中立物品, 53):** Organized into **Tiers 1–5** with timing badges and compact bilingual tiles.
  - **Special & Archive (肉山与历史, 172):** Separates Roshan & Map drops (Aegis, Cheese, Refresher Shard, Healing Lotus), upgrade variants, and neutral enchantments/historical entries so all 408 catalog items remain accessible without cluttering the live shop.
  - **Instant search, hover previews & inline Study Inspector:** Ranked cross-catalog search supports English names, Chinese names, 65+ player aliases (`bkb`, `跳刀`, `冰甲`, `先锋盾`, `ac`, `mkb`, `羊刀`, etc.), and category names; hovering any shop icon shows a dark-forest preview card, and clicking (or narrowing to 1 search match) opens the inline Study Inspector with `← / → / Esc` navigation, match coaching sentences, AI audio playback, bookmarks, and focused practice.
- Validation: **296 automated tests passed, 0 failed** (including `tests/test_learning_shop.js`), English UI smoke (`npm run smoke:en`) passed, and full Electron desktop smoke (`npm run smoke`) passed with all 408 offline PNGs decoded and zero horizontal overflow at wide (`1060×820`) and narrow (`620×730`) sizes.
- Previews: [Shop Basics](images/learning-items.png), [Shop Upgrades & Hover Preview](images/learning-items-upgrades.png), [Neutral Tiers](images/learning-items-neutral.png), [Search & Study Inspector](images/learning-items-inspector.png), [Narrow Layout](images/learning-items-narrow.png).
