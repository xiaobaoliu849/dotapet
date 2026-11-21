# DotaPad bilingual learning workspace

## Product brief

Evolve the existing DotaPet desktop companion into DotaPad: a desktop companion with a bilingual Dota 2 learning workspace inside the main Settings center. Open **Dota English / 刀塔英语学堂** in the sidebar to study heroes, hero abilities, items and team communication. Keep the pet on the desktop and retain voice, translation, appearance and phrase tools.

The core learning loop is **explore → read English → reveal Chinese → listen → save → answer a quiz → review later**. Learning must work without an AI key or an internet connection after installation. Network access is needed only for refreshing game content and opening patch notes. System speech availability depends on installed voices and the operating system.

The [current progress and next priorities](DOTAPAD_LEARNING_PROGRESS.md#2026-11-21--lesson-reliability-curriculum-and-packaging) track implementation and verification. The phases below describe the original learning design and its delivery history.

## Existing material and boundaries

- Local reference project: `D:\Projects\dota-2-bilingual-lexicon`.
- Public curriculum inputs: `data/official/heroes_official_v2.json`, `data/official/items_official.json`, and `data/phrases.ts`.
- Local official exports are dated March 29, 2026. Their date is not proof of the latest patch.
- Only public learning content was imported. No user records, tokens, configuration files or secrets belong in the new curriculum.
- The reference project remains unchanged. Existing untracked `promo-video/` work in DotaPet is outside this change.
- Preserve the current app identity, installer, shortcuts, desktop pet and user settings. A broader DotaPad rebrand can be a separate decision.

## Delivery phases

### Phase 1 — Offline learning foundation (implemented)

1. Register an isolated `learning` Settings page through the existing control center.
2. Add the sidebar entry immediately after voice and translation; retain collapsed-sidebar and Ctrl+Tab behavior.
3. Bundle a normalized catalog with stable numeric hero, ability and item IDs and stable phrase IDs.
4. Search English, Chinese, descriptions and parent hero names. Filter by subject.
5. Display English first, Chinese names beside it, and Chinese descriptions behind a disclosure.
6. Play the author's bundled AI-generated MP3 recordings from the bilingual lexicon at their original speed, with stop controls and automatic stop on navigation. Hero recordings are biographies; ability/item recordings include explanations. Mark missing recordings and label archive wording clearly.
7. Save lessons to a personal wordbook and persist quiz progress under Electron `userData`.
8. Offer multiple-choice recognition in both language directions, with distinct distractors from the same topic.
9. Schedule successful answers after 1, 3, 7, 14 and 30 days; failures become due after one minute. A practice session avoids repeating a card; start a new session to review newly due mistakes.
10. Display lesson count, saved words, due lessons and lifetime quiz accuracy.

### Phase 2 — Current official content (implemented; verification recorded in progress log)

Use Valve's public feeds:

- [Hero list](https://www.dota2.com/datafeed/herolist?language=english)
- [Item list](https://www.dota2.com/datafeed/itemlist?language=english)
- [Hero detail example](https://www.dota2.com/datafeed/herodata?hero_id=1&language=english)
- [Item detail example](https://www.dota2.com/datafeed/itemdata?item_id=1&language=english)
- [Official patch notes](https://www.dota2.com/patches/)

Fetch `english` and `schinese`, join localized records by numeric ID, and resolve description placeholders from supplied special values. Preserve unresolved tokens rather than inventing mechanics. Strip markup and render descriptions as text. Recipes are excluded from the item curriculum. Unnamed internal items are omitted with an explicit reason in catalog metadata.

Use four concurrent workers, a 25-second per-request timeout and three attempts per request. Download and validate the entire dataset before replacing the previous catalog with an atomic file rename. Persist user refreshes separately from the installed bundle. Keep local phrases and stable-ID progress across updates. A failed refresh leaves the previous offline catalog available.

Provide an explicit **Refresh from Valve** button with progress feedback. Do not fetch automatically on Settings open. Record `fetchedAt` and source metadata. The feed does not establish a patch number; display “Patch number unverified” and link to official patch notes. Never label an archive as latest or assume the timestamp identifies a patch.

Developer refresh: `npm run learning:update`. This updates the bundled snapshot for review and release. User refreshes update the local cached catalog only.

### Phase 3 — Deeper teaching (next iteration)

- Explain recurring ability language: “within range,” “per second,” “on hit,” “dispel,” “channel,” “root,” “silence,” “pierce debuff immunity,” and “cooldown.”
- Add original bilingual example sentences and usage notes, clearly separated from Valve's mechanics descriptions.
- Short daily sessions with 5/10 lessons, saved-only practice, due-mistake priority, automatic resume and completion summaries shipped on November 15, 2026. Two guided five-item lessons shipped on November 16 and now offer direct continuation from the completion summary.
- Add cloze questions and typed answers with accepted synonyms, punctuation normalization and Chinese variants.
- Add optional playback speed controls and regenerate stale or missing recordings from verified source text. The initial Windows system-voice playback has been replaced with the author's MP3 library.
- Include innate abilities, facets, talents, Shard and Scepter changes as separate lesson types. The initial catalog focuses on the abilities returned in the normal ability list and item descriptions.

### Phase 4 — Patch learning (next iteration)

- Store a previous snapshot and compute stable-ID changes to hero abilities and items.
- Show a bilingual “What changed?” reading exercise, with original source URL, retrieval time and verified patch number when available.
- Invalidate or reschedule affected mechanics questions when descriptions change.
- Flag removed content while preserving historical wordbook progress.
- Add updater tests for request failure, schema drift, cancellation, partial localization and changed special-value formatting.
- Add snapshot-size and coverage checks and review redistribution notices before a public installer release.

### Phase 5 — Companion-assisted learning (later)

- Optional pet reminders and a small “word of the day” desktop card, without interrupting matches.
- Optional roleplay through existing voice providers: call missing, request wards, discuss item timings.
- Keep offline reading and quizzes independent of paid AI providers. Make any cloud speech or AI usage explicit.
- Optional subtitle import: parse user-selected subtitle files, retain timestamps, and save expressions with context. No separate subtitle corpus was imported in this iteration.

## Architecture and persistence

| Component | Responsibility |
| --- | --- |
| `src/learning/catalog.json` | Bundled, dated bilingual snapshot |
| `src/learning/model.js` | Text normalization, localization pairing, search, quizzes and review intervals |
| `src/learning/study.js` | Validated session options, due-review ordering, bounded queues and local-day summaries |
| `src/learning/audio-manifest.json` | Stable lesson-ID mapping and missing-recording inventory |
| `src/renderer/assets/learning-audio/` | Original imported MP3 files bundled for offline use |
| `src/renderer/learning-audio.js` | Single-track MP3 playback, stop and playback-error handling |
| `src/learning/update.js` | Official feed fetching, validation and normalization |
| `src/main/learningController.js` | Trusted IPC, catalog cache, progress writes and external patch link |
| `src/preload/learning.js` | Narrow bridge for learning actions |
| `src/renderer/learning.*` | Responsive learning UI |
| `scripts/update-learning.mjs` | Maintainer snapshot refresh |
| `scripts/import-learning-audio.mjs` | Import matching MP3 files from the bilingual project's public audio directory |
| `tests/test_learning.js` | Curriculum, review, localization, persistence and IPC tests |
| `src/main/learningSmoke.js` | Real Electron search, bookmark, quiz and layout verification |

Current learning state: `learning-state.json` in `userData`, with stable-ID progress, study preferences, the current session and the last 180 completed-session summaries. Existing `learning-progress.json` records are migrated automatically on the first state write; the old file is left in place. Each answer updates progress, session position and completion history in one atomic write. A retried answer cannot count twice. Session questions retain a snapshot of their lessons so a catalog refresh cannot change a session already in progress.

Cached catalog: `learning-catalog.json` in the same directory. Use synchronous atomic writes for small progress updates; catalog network work stays asynchronous. Learning IPC accepts only the exact top-level learning document and only known actions and lesson IDs. It exposes no filesystem paths or renderer-controlled external URLs. The renderer has no network access, no Node integration and a restrictive CSP.

## Acceptance and validation

- Settings sidebar opens the learning page and the pet remains alive.
- Search, topic filters and saved lessons work with Chinese and English text.
- Quiz choices contain exactly one correct label and no duplicate distractors.
- Correctness, review intervals and bookmarks survive controller reloads.
- An untrusted document or child frame cannot invoke learning actions.
- Desktop smoke test exercises actual rendering, bookmarks, quiz submission and narrow-window overflow.
- English-language smoke includes the learning page; bilingual lesson text intentionally remains bilingual.
- Run `npm test`, `npm run smoke`, and `npm run smoke:en` before pushing.
- Review `git diff --check`, catalog coverage, source date and pending work; commit only this feature's files.
- Push a `codex/` feature branch. No installer release or default-branch merge is implied by that push.

## Iteration policy

Maintain `DOTAPAD_LEARNING_PROGRESS.md` with verified work, failures, fixes, validation results and next steps. Make concrete, reviewable commits. Continue iterations when requested; this document does not imply unattended future execution or scheduled GitHub pushes.
