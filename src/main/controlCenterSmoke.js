import { HUB_TOP } from './controlCenter.js';

/** Resolve once a page view has finished loading its document. */
export function pageLoaded(contents) {
  if (!contents) return Promise.reject(new Error('Settings page was not created'));
  if (!contents.isLoading() && contents.getURL().startsWith('file:')) return Promise.resolve();
  return new Promise(resolve => contents.once('did-finish-load', resolve));
}

async function freshCapture(contents, label = 'page') {
  // A hidden native window can return the previous compositor frame first.
  await contents.capturePage().catch(error => { throw new Error(`${label} capture: ${error.message}`); });
  await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  return contents.capturePage();
}

/**
 * Screenshot the whole settings center. A window capture holds only the
 * sidebar shell, so the visible page view is copied into it pixel by pixel.
 */
export async function captureHub(controlCenter, nativeImage) {
  const window = controlCenter.window;
  if (!window) throw new Error('Settings center is not open');
  const shell = await freshCapture(window.webContents, 'shell');
  const contents = controlCenter.contents(controlCenter.active);
  if (!contents) return shell;
  const page = await freshCapture(contents, controlCenter.active);
  const { width, height } = shell.getSize();
  const scale = width / window.getContentSize()[0];
  const pageSize = page.getSize();
  const target = Buffer.from(shell.toBitmap({ scaleFactor: 1 }));
  const source = page.toBitmap({ scaleFactor: 1 });
  const [left, top] = [Math.round(width - pageSize.width), Math.round(HUB_TOP * scale)];
  for (let row = 0; row < pageSize.height && top + row < height; row++) {
    source.copy(target, ((top + row) * width + left) * 4, row * pageSize.width * 4, (row + 1) * pageSize.width * 4);
  }
  return nativeImage.createFromBitmap(target, { width, height, scaleFactor: 1 });
}

/** Click a sidebar entry in the real shell and wait until main confirms the page. */
export async function navigateHub(controlCenter, page) {
  await pageLoaded(controlCenter.window.webContents);
  await controlCenter.window.webContents.executeJavaScript(`(async () => {
    const item = document.querySelector('.nav-item[data-page=${JSON.stringify(page)}]');
    for (let i = 0; i < 100 && (!item || item.hidden); i++) await new Promise(r => setTimeout(r, 20));
    if (!item || item.hidden) throw new Error('Sidebar entry missing: ${page}');
    item.click();
    for (let i = 0; i < 100 && item.getAttribute('aria-current') !== 'page'; i++) await new Promise(r => setTimeout(r, 20));
    if (item.getAttribute('aria-current') !== 'page') throw new Error('Sidebar did not show ${page}');
  })()`);
  if (controlCenter.active !== page) throw new Error(`Main did not switch to ${page}`);
}
