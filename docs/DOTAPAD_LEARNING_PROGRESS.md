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
