import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createControlCenter, hubLayout, HUB_TOP } from '../src/main/controlCenter.js';
import { isTrustedSettingsSender } from '../src/main/aiSettingsIpc.js';

const rendererDirectory = path.resolve('src/renderer');
const tick = () => new Promise(resolve => setImmediate(resolve));

class Contents extends EventEmitter {
  constructor() { super(); Object.assign(this, { mainFrame: {}, sent: [], destroyed: false, focused: 0 }); }
  loadFile(file) { this.mainFrame.url = pathToFileURL(file).href; this.file = path.basename(file); }
  send(...message) { this.sent.push(message); }
  isDestroyed() { return this.destroyed; }
  close() { this.destroyed = true; this.emit('destroyed'); }
  setWindowOpenHandler() {}
  focus() { this.focused++; }
}
class View {
  constructor(options) { Object.assign(this, { options, webContents: new Contents(), visible: true }); }
  setBackgroundColor(color) { this.background = color; }
  setBounds(bounds) { this.bounds = bounds; }
  setVisible(visible) { this.visible = visible; }
}

function fixture() {
  const windows = [], handlers = new Map(), calls = { closed: 0, phrases: 0 };
  class Window extends EventEmitter {
    constructor(options) {
      super(); windows.push(this);
      Object.assign(this, { options, webContents: new Contents(), size: [options.width, options.height], children: [], destroyed: false, visible: false });
      this.contentView = { addChildView: view => this.children.push(view), removeChildView: view => { this.children = this.children.filter(child => child !== view); } };
    }
    getContentSize() { return this.size; }
    setSize(width, height) { this.size = [width, height]; this.emit('resize'); }
    loadFile(file) { this.webContents.loadFile(file); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isMinimized() { return false; }
    setOpacity() {} setSkipTaskbar() {}
    showInactive() { this.visible = true; }
    show() { this.visible = true; } focus() {} moveTop() {} restore() {}
    close() { this.emit('close'); this.destroyed = true; this.emit('closed'); }
  }
  const electron = {
    BrowserWindow: Window, WebContentsView: View, app: { getVersion: () => '9.9.9' },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
  };
  const hub = createControlCenter({ electron, rendererDirectory, smokeTest: true,
    onClosed: () => calls.closed++, openPhrases: () => calls.phrases++ });
  const shell = () => ({ sender: windows.at(-1).webContents, senderFrame: windows.at(-1).webContents.mainFrame });
  const view = id => windows.at(-1).children.find(child => child.webContents === hub.contents(id));
  return { hub, windows, handlers, calls, shell, view };
}
const services = (log = []) => ({ file: 'ai-settings.html', preload: '../preload/ai-settings.js',
  onShow: contents => log.push(['show', contents.file]), onHide: contents => log.push(['hide', contents.file]) });

test('layout gives the page everything beside the sidebar and compacts narrow windows', () => {
  assert.deepEqual(hubLayout(1060, 820), { compact: false, sidebar: 196, content: { x: 196, y: HUB_TOP, width: 864, height: 820 - HUB_TOP } });
  assert.equal(hubLayout(760, 640).compact, false);
  assert.deepEqual(hubLayout(759, 640), { compact: true, sidebar: 64, content: { x: 64, y: HUB_TOP, width: 695, height: 640 - HUB_TOP } });
});

test('one window hosts isolated pages; switching hides the old page and keeps it alive', () => {
  const { hub, windows, view } = fixture(), log = [];
  hub.register('services', services(log));
  hub.register('appearance', { file: 'customize.html', preload: '../preload/customize.js', onShow: contents => log.push(['show', contents.file]) });
  const window = hub.open();
  assert.equal(windows.length, 1);
  assert.equal(window.webContents.file, 'control-center.html');
  assert.equal(hub.active, 'services');
  const settings = hub.contents('services');
  assert.equal(settings.file, 'ai-settings.html');
  assert.equal(view('services').options.webPreferences.preload, path.join(rendererDirectory, '../preload/ai-settings.js'));
  assert.equal(view('services').options.webPreferences.sandbox, true);
  assert.deepEqual(view('services').bounds, hubLayout(1060, 820).content);
  assert.equal(hub.open('appearance'), window, 'reopening reuses the window');
  assert.equal(view('services').visible, false);
  assert.equal(view('appearance').visible, true);
  assert.deepEqual(log, [['show', 'ai-settings.html'], ['hide', 'ai-settings.html'], ['show', 'customize.html']]);
  hub.open('help');
  assert.equal(view('appearance').visible, false, 'native pages hide every view');
  hub.open('services');
  assert.equal(hub.contents('services'), settings, 'returning keeps the same document and its drafts');
  hub.open();
  assert.equal(hub.active, 'services', 'opening without a page keeps the current one');
});

test('sidebar IPC accepts only the shell document and only pages that exist', async () => {
  const { hub, handlers, shell, calls } = fixture();
  hub.register('services', services());
  hub.open();
  const navigate = handlers.get('hub:navigate');
  assert.equal((await navigate(shell(), 'help')).ok, true);
  assert.equal(hub.active, 'help');
  assert.equal((await navigate(shell(), 'update')).ok, false, 'unregistered page');
  assert.equal((await navigate(shell(), 'https://example.com')).ok, false);
  const page = { sender: hub.contents('services'), senderFrame: hub.contents('services').mainFrame };
  assert.equal((await navigate(page, 'services')).ok, false, 'a page cannot drive the sidebar');
  assert.equal((await navigate({ ...shell(), senderFrame: { url: shell().senderFrame.url } }, 'services')).ok, false, 'subframe');
  assert.equal((await handlers.get('hub:open-phrases')(page)).ok, false);
  assert.equal((await handlers.get('hub:open-phrases')(shell())).ok, true);
  assert.equal(calls.phrases, 1);
  const { state } = await handlers.get('hub:state')(shell());
  assert.deepEqual(state.pages, ['services', 'phrases', 'help']);
  assert.equal(state.version, '9.9.9');
});

test('late pages appear in the sidebar and removed pages fall back to the setup page', async () => {
  const { hub, windows, handlers, shell } = fixture();
  hub.register('services', services());
  hub.open();
  hub.register('update', { file: 'update.html', preload: '../preload/update.js' });
  const pushed = windows[0].webContents.sent.filter(([channel]) => channel === 'hub:state').at(-1)[1];
  assert.ok(pushed.pages.includes('update'));
  assert.equal((await handlers.get('hub:navigate')(shell(), 'update')).ok, true);
  const updatePage = hub.contents('update');
  hub.unregister('update');
  assert.equal(updatePage.isDestroyed(), true);
  assert.equal(hub.active, 'services');
  assert.equal(hub.contents('update'), null);
  assert.throws(() => hub.register('help', {}), /Unknown settings page/);
  assert.throws(() => hub.register('elsewhere', {}), /Unknown settings page/);
});

test('closing runs page close hooks first, then destroys every page and reopens fresh', () => {
  const { hub, windows, calls } = fixture(), order = [];
  hub.register('services', { ...services(), onHubClose: () => order.push(`close:${Boolean(hub.contents('services'))}`) });
  hub.open();
  const page = hub.contents('services');
  windows[0].on('closed', () => order.push('closed'));
  hub.close();
  assert.deepEqual(order, ['close:true', 'closed'], 'close hooks run while pages still exist');
  assert.equal(page.isDestroyed(), true);
  assert.equal(calls.closed, 1);
  assert.equal(hub.window, null);
  assert.equal(hub.contents('services'), null);
  hub.open('help'); hub.close();
  hub.open();
  assert.equal(windows.length, 3);
  assert.equal(hub.active, 'services', 'a new window starts on the setup page');
});

test('resizing re-lays out every page and tells the sidebar when it compacts', () => {
  const { hub, windows, view } = fixture();
  hub.register('services', services());
  hub.open();
  windows[0].webContents.sent.length = 0;
  windows[0].setSize(700, 700);
  assert.deepEqual(view('services').bounds, hubLayout(700, 700).content);
  const [[channel, state]] = windows[0].webContents.sent;
  assert.equal(channel, 'hub:state');
  assert.deepEqual([state.compact, state.sidebar], [true, 64]);
  windows[0].webContents.sent.length = 0;
  windows[0].setSize(690, 650);
  assert.equal(windows[0].webContents.sent.length, 0, 'no update when the sidebar width is unchanged');
});

test('Ctrl+Tab and Ctrl+PageUp switch pages from inside a page; other keys pass through', () => {
  const { hub } = fixture();
  hub.register('services', services());
  hub.register('appearance', { file: 'customize.html', preload: '../preload/customize.js' });
  hub.open();
  const press = (contents, input) => {
    let prevented = false;
    contents.emit('before-input-event', { preventDefault: () => { prevented = true; } }, { type: 'keyDown', alt: false, meta: false, shift: false, control: true, ...input });
    return prevented;
  };
  assert.equal(press(hub.contents('services'), { key: 'Tab' }), true);
  assert.equal(hub.active, 'appearance');
  press(hub.contents('appearance'), { key: 'PageUp' });
  assert.equal(hub.active, 'services');
  press(hub.contents('services'), { key: 'Tab', shift: true });
  assert.equal(hub.active, 'help', 'backwards wraps to the last page');
  assert.equal(press(hub.contents('services'), { key: 'Tab', control: false }), false);
  assert.equal(press(hub.contents('services'), { key: 'a' }), false);
  assert.equal(press(hub.contents('services'), { key: 'Tab', type: 'keyUp' }), false);
});

test('a crashed page is rebuilt when it is showing; a clean exit is ignored', async () => {
  const { hub } = fixture();
  hub.register('services', services());
  hub.open();
  const first = hub.contents('services');
  first.emit('render-process-gone', {}, { reason: 'clean-exit' });
  await tick();
  assert.equal(hub.contents('services'), first);
  first.emit('render-process-gone', {}, { reason: 'crashed' });
  await tick();
  const rebuilt = hub.contents('services');
  assert.notEqual(rebuilt, first);
  assert.equal(first.isDestroyed(), true);
  assert.equal(rebuilt.file, 'ai-settings.html');
});

test('settings IPC trust also accepts a page view’s web contents', () => {
  const url = 'file:///trusted/ai-settings.html';
  let destroyed = false;
  const contents = { mainFrame: { url }, isDestroyed: () => destroyed };
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal(isTrustedSettingsSender(event, contents, url), true);
  destroyed = true;
  assert.equal(isTrustedSettingsSender(event, contents, url), false, 'a closed page is never trusted');
  destroyed = false;
  assert.equal(isTrustedSettingsSender(event, null, url), false);
  assert.equal(isTrustedSettingsSender({ ...event, senderFrame: { url } }, contents, url), false);
});
