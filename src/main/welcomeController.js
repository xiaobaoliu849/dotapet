import fs from 'node:fs';
import path from 'node:path';

export class WelcomeStore {
  constructor(directory) {
    this.filePath = path.join(directory, 'welcome.json');
    this.state = { dismissed: false };
    if (fs.existsSync(this.filePath)) {
      // Preserve a damaged file; never overwrite it at startup.
      try { this.state.dismissed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')).dismissed === true; }
      catch { this.state.dismissed = true; }
    }
  }
  dismiss(version) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ dismissed: true, version }, null, 2));
    fs.renameSync(temporary, this.filePath);
    this.state.dismissed = true;
  }
}

/**
 * First launch goes straight to the real setup. Help lives in that same
 * settings window, so there is no separate guide to open or maintain.
 */
export function createWelcomeController({ electron, openSettings }) {
  const store = new WelcomeStore(electron.app.getPath('userData'));
  return { store, showOnFirstRun() { if (!store.state.dismissed) return openSettings('voice', { firstRun: true }); } };
}
