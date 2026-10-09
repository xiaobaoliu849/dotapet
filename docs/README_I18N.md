# Languages

The settings center (all its pages) and the F6 Quick Phrases panel are available in Chinese, English, Russian and Ukrainian. The Russian and Ukrainian texts are machine-drafted and reviewed for layout; a native speaker should check them before a release. The pet's own toolbar, menus and tray are still Chinese.

**Choosing a language:** 设置中心 → 快捷键与帮助 → 🌐 界面语言. The default, 跟随系统 / Match Windows, uses the first Windows display language DotaPet has, and English when it has none. Switching reloads the settings center.

## How it works

Chinese is the source text, and every string is its own key. Pages keep writing Chinese; `src/renderer/i18n.js` translates text, tooltips and screen-reader labels as they reach the page, including messages that come from main. Main translates what it shows itself (such as file dialog titles) with `t()`.

- Dictionaries: `src/i18n/<id>.json`, mapping each Chinese string to its translation.
- Templates: parts filled in at run time are `{0}`, `{1}`… in both the key and the translation, for example `"已导入 {0} 个密钥并加密保存。": "Imported {0} key(s) and saved them encrypted."`. Two placeholders may not touch (`{0}{1}`): write each case as its own sentence instead.
- Names and user content (preset names, your phrases) are left alone: mark such elements `translate="no"`.

## Adding a language

1. Copy `src/i18n/en.json` to `src/i18n/<id>.json` (`ru`, `uk`…) and translate the values. Keep the keys exactly as they are.
2. Add `{ id: '<id>', name: '<the language in its own name>' }` to `LANGUAGES` in `src/i18n/index.js`.
3. Check it: `npm test` (placeholders and leftovers), then `npm run smoke -- --lang=<id>`, which opens every settings page and the F6 panel in that language, fails on any Chinese left or a character column that overflows, and saves a screenshot of each page (`language-*.png`) for checking the layout. Longer languages need short labels: sidebar hints of about 17 characters, and short row buttons.

After changing Chinese text in a page, add the new string to every dictionary; `npm run smoke:en` names any that are missing.
