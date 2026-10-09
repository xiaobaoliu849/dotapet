# UI screenshots

These images show the current 0.2.0 source UI, captured from the actual Electron app. They do not describe the older 0.1.2 installer on GitHub Releases.

Run this from the repository root on Windows after installing dependencies:

```powershell
npm run docs:screenshots
```

The command exercises the existing desktop smoke fixtures, then captures clean Chinese and English settings pages and F6 panels. Each run uses a separate temporary data directory and simulated audio devices. It does not read personal keys, connect to a voice provider, download a real update or install software. All expected images are checked before documentation images are replaced.

| Image | View |
|---|---|
| `welcome.png` / `settings-en.png` | Voice and translation settings |
| `appearance.png` / `appearance-en.png` | Appearance and background editor |
| `phrases.png` / `phrases-en.png` | Embedded bilingual phrase editor |
| `help.png` / `help-en.png` | Shortcuts and help |
| `quick-phrases.png` / `quick-phrases-en.png` | Floating F6 panel |
| `translation-settings.png` | DeepSeek translation configuration |
| `pet-rest.png` / `pet-toolbar.png` | Desktop companion at rest and with its toolbar |
| `update.png` | About and updates, including the project support card |

The update screenshot uses **simulated 0.3.0 release data**. This is a UI demonstration, not a published version. Settings captures include the actual sidebar and page content; the capture helper composites Electron's separate view surfaces without changing their appearance.

The dated `review-2026-10-08/` directory contains historical review captures. The READMEs use the refreshed images above.
