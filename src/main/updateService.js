import { EventEmitter } from 'node:events';

export const RELEASES_URL = 'https://github.com/xiaobaoliu849/dotapet/releases';

function publicInfo(info) {
  const notes = Array.isArray(info?.releaseNotes)
    ? info.releaseNotes.map(entry => entry.note || '').join('\n') : info?.releaseNotes || '';
  return {
    version: String(info?.version || '').slice(0, 80),
    notes: String(notes).replace(/<[^>]*>/g, '').slice(0, 3000),
  };
}

export function updateError(error) {
  const code = `${error?.code || ''} ${error?.message || ''}`;
  if (/SHA512|checksum|signature|ERR_UPDATER_INVALID/i.test(code)) return '更新包校验失败，未安装。请重试或查看发布页。';
  if (/CHANNEL_FILE_NOT_FOUND|LATEST_VERSION_NOT_FOUND|NO_PUBLISHED_VERSIONS|404/.test(code)) return '发布页还没有可用的更新信息，请稍后重试。';
  return '暂时无法更新，请检查网络后重试，也可从发布页下载安装包。';
}

/** No downloads at startup, no installation on normal quit, and no personal-data writes. */
export class UpdateService extends EventEmitter {
  constructor({ updater, currentVersion, enabled }) {
    super();
    this.updater = updater;
    this.enabled = enabled;
    this.state = { phase: enabled ? 'idle' : 'disabled', currentVersion, version: '', notes: '', percent: 0, restartRequested: false, error: '' };
    this.checking = null;
    this.downloading = null;
    this.listeners = [];
    if (!enabled) return;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    const listen = (event, handler) => { updater.on(event, handler); this.listeners.push([event, handler]); };
    listen('checking-for-update', () => this.publish({ phase: 'checking', error: '' }));
    listen('update-available', info => this.publish({ ...publicInfo(info), phase: 'available', percent: 0, error: '' }));
    listen('update-not-available', () => this.publish({ phase: 'current', version: '', notes: '', error: '' }));
    listen('download-progress', progress => this.publish({ percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)) }));
    listen('update-downloaded', info => this.publish({ ...publicInfo(info), phase: 'ready', percent: 100, error: '' }));
    listen('error', error => this.fail(error));
  }

  snapshot() { return { ...this.state }; }
  publish(patch) { this.state = { ...this.state, ...patch }; this.emit('state', this.snapshot()); }
  fail(error) { this.publish({ phase: 'error', restartRequested: false, error: updateError(error) }); }

  check() {
    if (!this.enabled || this.downloading || ['ready', 'installing'].includes(this.state.phase)) return Promise.resolve(this.snapshot());
    if (this.checking) return this.checking;
    // Defer the call until the single-flight guard is assigned, including synchronous failures.
    this.checking = Promise.resolve().then(() => this.updater.checkForUpdates())
      .catch(error => this.fail(error)).then(() => this.snapshot()).finally(() => { this.checking = null; });
    return this.checking;
  }

  updateAndRestart() {
    if (!this.enabled || this.downloading || this.checking || this.state.phase === 'installing') return Promise.resolve(this.snapshot());
    if (this.state.phase === 'ready') { this.install(); return Promise.resolve(this.snapshot()); }
    if (this.state.phase !== 'available') return Promise.resolve(this.snapshot());
    this.publish({ phase: 'downloading', percent: 0, error: '', restartRequested: true });
    this.downloading = Promise.resolve().then(() => this.updater.downloadUpdate()).then(() => {
      // Only a verified download may install. An error event revokes restart permission.
      if (this.state.phase === 'ready' && this.state.restartRequested) this.install();
      else if (this.state.phase === 'downloading') this.fail(new Error('Download did not complete verification'));
    }).catch(error => this.fail(error)).then(() => this.snapshot()).finally(() => { this.downloading = null; });
    return this.downloading;
  }

  postpone() { if (this.state.restartRequested) this.publish({ restartRequested: false }); }
  install() {
    if (this.state.phase !== 'ready') return;
    this.publish({ phase: 'installing', restartRequested: false });
    try { this.updater.quitAndInstall(true, true); }
    catch (error) { this.fail(error); }
  }
  start() {
    if (!this.enabled || this.startupTimer) return;
    this.startupTimer = setTimeout(() => { void this.check(); }, 15000);
    this.interval = setInterval(() => { void this.check(); }, 4 * 60 * 60 * 1000);
    this.startupTimer.unref?.(); this.interval.unref?.();
  }
  dispose() {
    clearTimeout(this.startupTimer); clearInterval(this.interval);
    this.postpone();
    for (const [event, handler] of this.listeners) this.updater.removeListener(event, handler);
  }
}
