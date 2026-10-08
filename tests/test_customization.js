import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CustomizationStore, decodeImage, MAX_IMAGE_BYTES } from '../src/main/customizationStore.js';
import { classifySkin, normalizeProfile, resolveAppearance } from '../src/services/appearance.js';
import { createCustomizationController } from '../src/main/customizationIpc.js';
import { fileURLToPath, pathToFileURL } from 'node:url';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="50" fill="#76b79c"/></svg>').toString('base64')}`;
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'customization-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new CustomizationStore(directory);
}

test('images are copied once and reused by heroes, pets and backgrounds after restart', t => {
  const store = fixture(t);
  const asset = store.importImage({ dataUrl: png, name: 'My picture' });
  assert.equal(store.importImage({ dataUrl: png, name: 'Duplicate' }).id, asset.id);
  const profile = normalizeProfile({ appearance: { assetId: asset.id, scale: 1.25, x: 30 }, background: { mode: 'image', assetId: asset.id, scope: 'scene' } });
  store.saveProfile('hero:invoker', profile); store.saveProfile('pet:aurora_wolf', profile);
  const reloaded = new CustomizationStore(store.directory);
  assert.equal(reloaded.snapshot().assets.length, 1);
  assert.deepEqual(reloaded.snapshot().profiles['hero:invoker'], profile);
  const resolved = resolveAppearance(reloaded.snapshot().profiles['pet:aurora_wolf'], reloaded.snapshot().assets, 'default.svg');
  assert.match(resolved.src, /^file:/);
  assert.deepEqual(fs.readFileSync(new URL(resolved.src)), decodeImage(png).bytes);
  assert.equal(resolved.profile.appearance.scale, 1.25);
});

test('migration is idempotent, deduplicates shared uploads and preserves selections', t => {
  const store = fixture(t);
  const entries = ['invoker', 'lina'].map(heroId => ({ heroId, activeSkinId: 'custom_old', skins: { custom_old: { name: '旧立绘', sprites: { idle: png } } } }));
  assert.deepEqual(store.migrateLegacy(entries), []);
  const original = store.snapshot();
  store.migrateLegacy(entries);
  assert.deepEqual(store.snapshot(), original);
  assert.equal(original.assets.length, 1);
  assert.equal(original.profiles['hero:invoker'].appearance.assetId, original.profiles['hero:lina'].appearance.assetId);
  store.saveProfile('hero:invoker', normalizeProfile());
  store.migrateLegacy(entries);
  assert.equal(store.snapshot().profiles['hero:invoker'].appearance.assetId, null, 'restart must not re-equip a removed legacy appearance');
});

test('failed migration retains the old selection for retry and does not destroy healthy imports', t => {
  const store = fixture(t);
  const entries = [{ heroId: 'pudge', activeSkinId: 'custom_broken', skins: { custom_broken: { sprites: { idle: 'broken' } }, custom_healthy: { sprites: { idle: png } } } }];
  assert.equal(store.migrateLegacy(entries).length, 1);
  assert.equal(store.snapshot().assets.length, 1);
  assert.equal(store.snapshot().profiles['hero:pudge'], undefined);
  entries[0].skins.custom_broken.sprites.idle = svg;
  assert.deepEqual(store.migrateLegacy(entries), []);
  assert.ok(store.snapshot().profiles['hero:pudge'].appearance.assetId);
});

test('migrated color themes retain their accent without requiring bespoke artwork', t => {
  const store = fixture(t);
  store.migrateLegacy([{ heroId: 'invoker', activeSkinId: 'dark_artistry', themeColor: '#a855f7' }]);
  assert.equal(store.snapshot().profiles['hero:invoker'].accent, '#a855f7');
});

test('exported presets include their assets and import on another installation without paths or credentials', t => {
  const store = fixture(t), other = fixture(t);
  const first = store.importImage({ dataUrl: png, name: 'Portrait' });
  const second = store.importImage({ dataUrl: svg, name: 'Background' });
  const profile = normalizeProfile({ appearance: { assetId: first.id, style: 'warm' }, background: { mode: 'image', assetId: second.id, scope: 'scene', opacity: .4 } });
  const preset = store.savePreset('Warm companion', profile);
  const bundle = store.exportPreset(preset.id);
  assert.equal(bundle.assets.length, 2);
  assert.ok(!JSON.stringify(bundle).includes('file:'));
  const imported = other.importPreset(bundle);
  other.saveProfile('pet:baby_roshan', imported.profile);
  assert.equal(other.snapshot().assets.length, 2);
  assert.equal(other.snapshot().profiles['pet:baby_roshan'].appearance.style, 'warm');
  assert.equal(resolveAppearance(imported.profile, other.snapshot().assets, 'default.svg').imported, true);
});

test('incomplete preset import rolls back metadata and preserves existing customization', t => {
  const store = fixture(t);
  store.importImage({ dataUrl: png, name: 'Existing' });
  const before = store.snapshot();
  assert.throws(() => store.importPreset({ format: 'voicespirit-customization', version: 1, profile: { appearance: { assetId: 'missing' } }, assets: [{ id: 'another', dataUrl: svg }] }), /缺少/);
  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(new CustomizationStore(store.directory).snapshot(), before);
  assert.equal(fs.readdirSync(store.assetsDirectory).length, 1, 'failed imports must not leave orphan image files');
});

test('deleting an asset clears every profile and preset reference and survives restart', t => {
  const store = fixture(t);
  const asset = store.importImage({ dataUrl: png });
  const profile = normalizeProfile({ appearance: { assetId: asset.id }, background: { mode: 'image', assetId: asset.id } });
  store.saveProfile('hero:invoker', profile); store.saveProfile('pet:donkey_courier', profile); store.savePreset('Saved', profile);
  store.removeAsset(asset.id);
  const state = new CustomizationStore(store.directory).snapshot();
  assert.equal(state.assets.length, 0);
  for (const p of [...Object.values(state.profiles), state.presets[0].profile]) {
    assert.equal(p.appearance.assetId, null); assert.equal(p.background.mode, 'transparent');
  }
  assert.equal(fs.existsSync(store.assetPath(asset)), false);
});

test('library names and favorites persist without duplicating assets', t => {
  const store = fixture(t);
  const asset = store.importImage({ dataUrl: svg, name: 'First' });
  store.updateAsset(asset.id, { name: 'Favorite', favorite: true });
  const reloaded = new CustomizationStore(store.directory).snapshot();
  assert.equal(reloaded.assets[0].name, 'Favorite'); assert.equal(reloaded.assets[0].favorite, true);
});

test('invalid image data, excessive files and unsupported bundles cannot become assets', t => {
  const store = fixture(t);
  assert.throws(() => store.importImage({ dataUrl: 'data:image/png;base64,YmFk' }), /格式无效/);
  assert.throws(() => decodeImage(`data:image/png;base64,${'A'.repeat(MAX_IMAGE_BYTES * 1.5)}`), /12 MB/);
  const scriptSvg = 'data:image/svg+xml;base64,' + Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64');
  assert.throws(() => decodeImage(scriptSvg), /SVG/);
  assert.throws(() => store.importPreset({ format: 'voicespirit-customization', version: 2, assets: [] }), /有效/);
  assert.equal(store.snapshot().assets.length, 0);
});

test('profile validation prevents absent assets, invalid targets and unsafe render values', t => {
  const store = fixture(t);
  assert.throws(() => store.saveProfile('hero:../../escape', {}), /角色无效/);
  assert.throws(() => store.saveProfile('hero:invoker', { appearance: { assetId: 'unknown' } }), /不存在/);
  const p = normalizeProfile({ appearance: { scale: 999, x: -400, style: 'constructor' }, background: { mode: 'unsafe', color: 'url(https://example.com)', opacity: -2 }, accent: 'red' });
  assert.equal(p.appearance.scale, 1.6); assert.equal(p.appearance.x, 0); assert.equal(p.appearance.style, 'original');
  assert.equal(p.background.mode, 'transparent'); assert.equal(p.background.opacity, 0); assert.equal(p.accent, null);
});

test('a missing or unchanged skin is categorized as a theme, real images remain equipable', () => {
  const hero = { sprites: { idle: 'base.svg', speaking: 'talk.svg', action: 'action.svg' } };
  assert.equal(classifySkin(hero, {}), 'theme');
  assert.equal(classifySkin(hero, { sprites: hero.sprites }), 'theme');
  assert.equal(classifySkin(hero, { sprites: { idle: 'another.svg' } }), 'appearance');
  const p = normalizeProfile({ appearance: { builtinId: 'different' } });
  assert.equal(resolveAppearance(p, [], 'base.svg', { different: { sprites: { idle: 'another.svg' } } }, 'speaking').src, 'another.svg');
});

test('unreadable settings are preserved for recovery instead of overwritten', t => {
  const store = fixture(t);
  fs.writeFileSync(store.filePath, '{broken');
  assert.throws(() => new CustomizationStore(store.directory));
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), '{broken');
});

test('customization IPC rejects foreign frames, navigated pages and desktop library writes', t => {
  const store = fixture(t), handlers = new Map();
  const rendererDirectory = fileURLToPath(new URL('../src/renderer', import.meta.url));
  const mainFrame = { url: pathToFileURL(path.join(rendererDirectory, 'index.html')).href };
  const desktop = { isDestroyed: () => false, webContents: { mainFrame, send() {} } };
  createCustomizationController({
    electron: { app: { getPath: () => store.directory }, ipcMain: { handle: (name, handler) => handlers.set(name, handler) } },
    rendererDirectory, getMainWindow: () => desktop, getHeroesConfig: () => ({ heroes: {} }),
    getCompanionHero: () => null, getActiveKey: () => 'pet:aurora_wolf', smokeTest: true,
  });
  const trusted = { sender: desktop.webContents, senderFrame: mainFrame };
  return (async () => {
    assert.equal((await handlers.get('customization:get')(trusted)).ok, true);
    assert.equal((await handlers.get('customization:import-image')(trusted, { dataUrl: png })).ok, false);
    assert.equal((await handlers.get('customization:get')({ ...trusted, sender: {} })).ok, false);
    assert.equal((await handlers.get('customization:get')({ ...trusted, senderFrame: { url: mainFrame.url } })).ok, false);
    mainFrame.url = 'https://example.com';
    assert.equal((await handlers.get('customization:get')(trusted)).ok, false);
  })();
});

test('single-frame GIFs are static; multi-frame GIFs retain their animated classification', t => {
  const store = fixture(t);
  const bytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const single = store.importImage({ dataUrl: `data:image/gif;base64,${bytes.toString('base64')}` });
  assert.equal(single.animated, false);
  const imageStart = bytes.indexOf(0x2c, 19);
  const multiple = Buffer.concat([bytes.subarray(0, bytes.length - 1), bytes.subarray(imageStart)]);
  const animated = store.importImage({ dataUrl: `data:image/gif;base64,${multiple.toString('base64')}` });
  assert.equal(animated.animated, true);
});
