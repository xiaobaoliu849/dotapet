import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { presentSettingsWhenReady, settingsWindowBounds } from './settingsPresentation.js';
import { isTrustedSettingsSender } from './aiSettingsIpc.js';

/** Height of the shell's top bar; the native window buttons sit inside it. */
export const HUB_TOP = 40;
/** The shell's sidebar CSS transition runs this long; the page view slides with it. */
export const SIDEBAR_SLIDE_MS = 200;
/** Pages drawn by the shell itself; every other page is an isolated view. */
export const NATIVE_PAGES = ['help'];
export const PAGE_ORDER = ['services', 'appearance', 'phrases', 'help', 'update'];

/**
 * Main owns the geometry so the sidebar and the page view never disagree.
 * A narrow window always gets the icon-only sidebar; a wide one only when collapsed.
 */
export function hubLayout(width, height, collapsed = false) {
  const narrow = width < 760;
  const compact = narrow || collapsed;
  const sidebar = compact ? 64 : 196;
  return { compact, narrow, sidebar,
    content: { x: sidebar, y: HUB_TOP, width: Math.max(0, width - sidebar), height: Math.max(0, height - HUB_TOP) } };
}

/**
 * One settings window with a sidebar. Each registered page keeps its own
 * document, preload and IPC trust, so a page cannot reach another page's API
 * and its unsaved input survives switching pages.
 */
export function createControlCenter({ electron, rendererDirectory, icon, smokeTest = false, onClosed = () => {}, onFocusChange = () => {},
  sidebarCollapsed = false, onSidebarCollapsedChange = () => {} }) {
  const { BrowserWindow, WebContentsView, ipcMain, screen, app } = electron;
  const shellURL = pathToFileURL(path.join(rendererDirectory, 'control-center.html')).href;
  const pages = new Map();
  const views = new Map();
  let window = null;
  let active = 'services';
  let collapsed = Boolean(sidebarCollapsed);
  let geometry = hubLayout(1060, 820, collapsed);
  let slide = null;
  // Smoke tests and reduced-motion users get the final layout at once.
  const animate = () => !smokeTest && !electron.systemPreferences?.getAnimationSettings?.()?.prefersReducedMotion;

  const alive = () => Boolean(window && !window.isDestroyed());
  const available = () => PAGE_ORDER.filter(id => NATIVE_PAGES.includes(id) || pages.has(id));
  const state = () => ({ pages: available(), active, compact: geometry.compact, narrow: geometry.narrow, collapsed,
    sidebar: geometry.sidebar, top: HUB_TOP,
    version: app?.getVersion?.() || '' });
  function publishState() {
    if (alive() && !window.webContents.isDestroyed()) window.webContents.send('hub:state', state());
  }
  function stopSlide() { clearInterval(slide); slide = null; }
  function layout(changed = false) {
    if (!alive()) return;
    stopSlide();
    const previous = geometry;
    geometry = hubLayout(...window.getContentSize(), collapsed);
    for (const view of views.values()) view.setBounds(geometry.content);
    if (changed || geometry.sidebar !== previous.sidebar || geometry.narrow !== previous.narrow) publishState();
  }
  /**
   * Fold or unfold: the page view eases to its new edge in step with the sidebar's CSS transition.
   * It slides at the wider of its two widths (the part past the window edge is clipped), so the
   * page only moves and never re-lays itself out mid-fold; an unfold settles its width once, at the end.
   */
  function slideLayout() {
    if (!alive()) return;
    stopSlide();
    const from = geometry.content;
    geometry = hubLayout(...window.getContentSize(), collapsed);
    const to = geometry.content;
    publishState();
    if (!animate() || from.x === to.x) { for (const view of views.values()) view.setBounds(to); return; }
    const width = Math.max(from.width, to.width);
    const start = Date.now();
    const step = () => {
      if (!alive()) return stopSlide();
      const t = Math.min(1, (Date.now() - start) / SIDEBAR_SLIDE_MS);
      const eased = 1 - (1 - t) ** 3;
      const bounds = t === 1 ? to : { ...to, x: Math.round(from.x + (to.x - from.x) * eased), width };
      for (const view of views.values()) view.setBounds(bounds);
      if (t === 1) stopSlide();
    };
    step();
    slide = setInterval(step, 16);
  }
  function detach(id, view) {
    if (views.get(id) !== view) return false;
    views.delete(id);
    if (alive()) window.contentView.removeChildView(view);
    return true;
  }
  function closeView(id) {
    const view = views.get(id);
    if (view && detach(id, view) && !view.webContents.isDestroyed()) view.webContents.close();
  }
  /**
   * Focus inside a page cannot Tab back to the sidebar (separate documents),
   * so the usual tab-switching keys move between pages from anywhere.
   */
  function switchKeys(event, input) {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;
    const forward = input.key === 'Tab' ? !input.shift : input.key === 'PageDown' ? true : input.key === 'PageUp' ? false : null;
    if (forward === null) return;
    event.preventDefault();
    const order = available();
    show(order[(order.indexOf(active) + (forward ? 1 : order.length - 1)) % order.length]);
  }
  function createView(id) {
    const page = pages.get(id);
    const view = new WebContentsView({ webPreferences: {
      preload: path.join(rendererDirectory, page.preload), contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: page.backgroundThrottling ?? true,
    } });
    view.setBackgroundColor(page.background || '#f6f7f2');
    const contents = view.webContents;
    contents.on('will-navigate', event => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('before-input-event', switchKeys);
    contents.once('destroyed', () => detach(id, view));
    // A crashed page is rebuilt (unsaved input is already lost) instead of staying blank.
    contents.on('render-process-gone', (_event, details) => {
      if (details?.reason === 'clean-exit' || views.get(id) !== view) return;
      setImmediate(() => {
        if (views.get(id) !== view) return;
        closeView(id);
        if (active === id) show(id);
      });
    });
    views.set(id, view);
    window.contentView.addChildView(view);
    view.setBounds(geometry.content);
    page.onCreated?.(contents);
    contents.loadFile(path.join(rendererDirectory, page.file), page.query ? { query: page.query } : undefined);
    return view;
  }
  function show(id) {
    if (!alive()) return;
    if (!available().includes(id)) id = 'services';
    const previous = active;
    active = id;
    const target = NATIVE_PAGES.includes(id) ? null : views.get(id) || createView(id);
    for (const [key, view] of views) view.setVisible(key === id);
    // Pages release what they hold while out of sight (the microphone check).
    if (previous !== id && views.has(previous)) pages.get(previous)?.onHide?.(views.get(previous).webContents);
    layout();
    publishState();
    if (target) {
      if (window.isVisible()) target.webContents.focus();
      pages.get(id).onShow?.(target.webContents);
    } else if (window.isVisible()) window.webContents.focus();
  }
  function create() {
    window = new BrowserWindow({
      icon, ...settingsWindowBounds(screen.getPrimaryDisplay().workArea, { width: 1060, height: 820, minWidth: 620, minHeight: 640 }),
      title: '刀塔宠物 · 设置中心', titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#eef1ea', symbolColor: '#52604f', height: HUB_TOP },
      // Not owned by the pet: an owned window minimizes to a stub above the
      // taskbar instead of to its own taskbar button.
      autoHideMenuBar: true, show: false, backgroundColor: '#f6f7f2',
      webPreferences: { preload: path.join(rendererDirectory, '../preload/control-center.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const created = window;
    created.webContents.on('will-navigate', event => event.preventDefault());
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    created.webContents.on('before-input-event', switchKeys);
    for (const event of ['resize', 'maximize', 'unmaximize', 'restore']) created.on(event, layout);
    // The window has focus when shown; hand it to the visible page.
    // A window that is closing no longer speaks for the settings center.
    created.on('focus', () => {
      if (window !== created) return;
      const view = views.get(active);
      if (view && !view.webContents.isDestroyed()) view.webContents.focus();
      onFocusChange(true);
    });
    for (const event of ['blur', 'minimize', 'hide']) created.on(event, () => { if (window === created) onFocusChange(false); });
    presentSettingsWhenReady(created, { smokeTest });
    // Views switched inside a never-shown window lose their surface, so smoke
    // tests show the window invisibly to exercise the real, visible path.
    if (smokeTest) { created.setOpacity(0); created.setSkipTaskbar(true); created.showInactive(); }
    // Synchronous, like closing the old standalone windows: nothing may slip in before it.
    // Electron destroys the window asynchronously; from 'close' on it is gone,
    // so an open() in between builds a fresh window instead of reusing this one.
    created.on('close', () => {
      if (window !== created) return;
      stopSlide();
      for (const page of pages.values()) page.onHubClose?.();
      for (const id of [...views.keys()]) closeView(id);
      window = null;
      onFocusChange(false);
    });
    // A newer window may already be open; then it owns the closing duties.
    created.on('closed', () => { if (!window) onClosed(); });
    // The pages are placed beside a folded sidebar at once; the shell must not paint a wide one first.
    created.loadFile(path.join(rendererDirectory, 'control-center.html'), collapsed ? { query: { sidebar: 'collapsed' } } : undefined);
  }

  /** Open on a page, or on the page last shown when none is named. */
  function open(id) {
    const existed = alive();
    if (!existed) { create(); active = 'services'; }
    show(id || active);
    if (existed && !smokeTest) {
      if (window.isMinimized()) window.restore();
      window.show(); window.focus(); window.moveTop();
    }
    return window;
  }
  function register(id, page) {
    if (NATIVE_PAGES.includes(id) || !PAGE_ORDER.includes(id)) throw new Error(`Unknown settings page: ${id}`);
    pages.set(id, page);
    publishState();
  }
  function unregister(id) {
    closeView(id);
    pages.delete(id);
    if (active === id) show('services');
    else publishState();
  }

  const trustedShell = event => isTrustedSettingsSender(event, window, shellURL);
  ipcMain.handle('hub:state', event => trustedShell(event) ? { ok: true, state: state() } : { ok: false });
  ipcMain.handle('hub:navigate', (event, id) => {
    if (!trustedShell(event) || !available().includes(id)) return { ok: false };
    show(id);
    return { ok: true, state: state() };
  });
  // Only the choice is remembered; a narrow window stays icon-only either way.
  ipcMain.handle('hub:set-sidebar-collapsed', (event, value) => {
    if (!trustedShell(event) || typeof value !== 'boolean') return { ok: false };
    if (value !== collapsed) {
      collapsed = value;
      slideLayout();
      onSidebarCollapsedChange(collapsed);
    }
    return { ok: true, state: state() };
  });

  return {
    open, register, unregister,
    get window() { return alive() ? window : null; },
    get active() { return active; },
    /** Live contents of a page, or null; IPC trust checks compare against this. */
    contents(id) { const contents = views.get(id)?.webContents; return contents && !contents.isDestroyed() ? contents : null; },
    close() { if (alive()) window.close(); },
  };
}
