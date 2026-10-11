import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CustomizationStore, MAX_CUSTOM_CHARACTERS, isCustomCharacterId } from '../src/main/customizationStore.js';
import { createCustomizationController } from '../src/main/customizationIpc.js';
import { validCharacterKey } from '../src/services/appearance.js';
import { buildPetPseudoHero } from '../src/services/petPersona.js';
import { applyPersonaOverride } from '../src/services/personaOverride.js';
import { CloudVoiceEngine } from '../src/services/cloudVoiceEngine.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
const svg = text => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><text>${text}</text></svg>`).toString('base64')}`;
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-character-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new CustomizationStore(directory);
}

test('a custom character needs a name and an idle picture; talking and interaction pictures are optional', t => {
  const store = fixture(t);
  const idle = store.importImage({ dataUrl: png, name: 'cat' });
  assert.throws(() => store.createCharacter({ name: '  ', sprites: { idle: idle.id } }), /名字/);
  assert.throws(() => store.createCharacter({ name: '咪咪', sprites: {} }), /形象图片/);
  assert.throws(() => store.createCharacter({ name: '咪咪', sprites: { idle: 'asset_missing' } }), /不存在/);
  const cat = store.createCharacter({ name: ` 咪咪\u0007${'喵'.repeat(60)} `, sprites: { idle: idle.id } });
  assert.ok(isCustomCharacterId(cat.id));
  assert.ok(validCharacterKey(`pet:${cat.id}`), 'its key is a valid profile key');
  assert.equal(cat.name.length, 40);
  assert.ok(cat.name.startsWith('咪咪喵'));
  assert.deepEqual(cat.sprites, { idle: idle.id, speaking: null, action: null });
  assert.deepEqual(new CustomizationStore(store.directory).snapshot().customCharacters, [cat]);
});

test('pictures and names update per slot, and the idle picture cannot be cleared', t => {
  const store = fixture(t);
  const [idle, talk, act] = ['a', 'b', 'c'].map(text => store.importImage({ dataUrl: svg(text) }));
  const { id } = store.createCharacter({ name: 'Mimi', sprites: { idle: idle.id } });
  assert.deepEqual(store.updateCharacter(id, { sprites: { speaking: talk.id } }).sprites, { idle: idle.id, speaking: talk.id, action: null });
  assert.deepEqual(store.updateCharacter(id, { sprites: { action: act.id } }).sprites, { idle: idle.id, speaking: talk.id, action: act.id });
  assert.deepEqual(store.updateCharacter(id, { sprites: { speaking: null } }).sprites, { idle: idle.id, speaking: null, action: act.id });
  assert.throws(() => store.updateCharacter(id, { sprites: { idle: null } }), /形象图片/);
  assert.equal(store.updateCharacter(id, { name: 'Mochi' }).name, 'Mochi');
  assert.throws(() => store.updateCharacter('custom_00000000', { name: 'x' }), /不存在/);
});

test('deleting a picture: refused while it is a character\'s idle picture, cleared from optional slots', t => {
  const store = fixture(t);
  const [idle, talk] = ['a', 'b'].map(text => store.importImage({ dataUrl: svg(text) }));
  const { id } = store.createCharacter({ name: 'Mimi', sprites: { idle: idle.id, speaking: talk.id } });
  assert.throws(() => store.removeAsset(idle.id), /Mimi/);
  assert.ok(store.data.assets.some(asset => asset.id === idle.id), 'refused deletion keeps the picture');
  store.removeAsset(talk.id);
  assert.equal(store.data.characters.find(c => c.id === id).sprites.speaking, null);
});

test('deleting a character removes its look and persona but keeps its pictures', t => {
  const store = fixture(t);
  const idle = store.importImage({ dataUrl: png });
  const { id } = store.createCharacter({ name: 'Mimi', sprites: { idle: idle.id } });
  store.saveProfile(`pet:${id}`, { persona: '傲娇的猫', accent: '#112233' });
  store.removeCharacter(id);
  assert.equal(store.data.characters.length, 0);
  assert.equal(store.data.profiles[`pet:${id}`], undefined);
  assert.equal(store.data.assets.length, 1);
  assert.throws(() => store.removeCharacter(id), /不存在/);
});

test('custom characters are limited, and files from before they existed still load', t => {
  const store = fixture(t);
  const idle = store.importImage({ dataUrl: png });
  for (let i = 0; i < MAX_CUSTOM_CHARACTERS; i++) store.createCharacter({ name: `c${i}`, sprites: { idle: idle.id } });
  assert.throws(() => store.createCharacter({ name: 'one more', sprites: { idle: idle.id } }), /最多/);
  const legacy = fixture(t);
  fs.writeFileSync(legacy.filePath, JSON.stringify({ version: 1, assets: [], profiles: {}, presets: [], migrated: [] }));
  assert.deepEqual(new CustomizationStore(legacy.directory).snapshot().customCharacters, []);
});

test('the catalog lists custom characters with picture URLs, falling back to the idle picture', async t => {
  const store = fixture(t), handlers = new Map();
  const rendererDirectory = fileURLToPath(new URL('../src/renderer', import.meta.url));
  const mainFrame = { url: pathToFileURL(path.join(rendererDirectory, 'index.html')).href };
  const desktop = { isDestroyed: () => false, webContents: { mainFrame, send() {} } };
  const controller = createCustomizationController({
    electron: { app: { getPath: () => store.directory }, ipcMain: { handle: (name, handler) => handlers.set(name, handler) } },
    rendererDirectory, getMainWindow: () => desktop, getHeroesConfig: () => ({ heroes: {} }),
    getCompanionHero: () => null, getActiveKey: () => 'pet:aurora_wolf',
  });
  const [idle, talk] = ['a', 'b'].map(text => controller.store.importImage({ dataUrl: svg(text) }));
  const cat = controller.store.createCharacter({ name: '咪咪', sprites: { idle: idle.id, speaking: talk.id } });
  const trusted = { sender: desktop.webContents, senderFrame: mainFrame };
  const { state } = await handlers.get('customization:get')(trusted);
  const entry = state.characters.find(c => c.key === `pet:${cat.id}`);
  assert.equal(entry.custom, true);
  assert.equal(entry.name, '咪咪');
  assert.match(entry.sprites.idle, /^file:.*customization-assets/);
  assert.notEqual(entry.sprites.speaking, entry.sprites.idle);
  assert.equal(entry.sprites.action, entry.sprites.idle, 'an empty slot shows the idle picture');
  const keys = state.characters.map(c => c.key);
  assert.ok(keys.indexOf(entry.key) < keys.findIndex(key => key.startsWith('hero:')) || !keys.some(key => key.startsWith('hero:')));
  // The desktop may read the catalog, but only the editor may change characters.
  assert.equal((await handlers.get('customization:create-character')(trusted, { name: 'x', sprites: { idle: idle.id } })).ok, false);
  assert.equal((await handlers.get('customization:remove-character')(trusted, cat.id)).ok, false);
});

test('a custom character talks as itself, with the user\'s persona, never as a courier or hero', () => {
  const persona = buildPetPseudoHero({ name: 'custom_0a1b2c3d', displayName: '咪咪', description: '' });
  assert.equal(persona.kind, 'custom');
  assert.equal(persona.nameEn, '咪咪', 'the user\'s name is the name in every language');
  assert.equal(buildPetPseudoHero({ name: 'baby_roshan', displayName: '肉山宝宝 (Baby Roshan)' }).kind, 'pet');
  for (const provider of ['doubao', 'cartesia']) {
    const engine = new CloudVoiceEngine({ provider, currentHero: applyPersonaOverride(persona, '一只高冷的橘猫，看不起所有人') });
    const prompt = engine.getHeroSystemPrompt();
    assert.ok(prompt.includes('一只高冷的橘猫'));
    assert.ok(prompt.includes('咪咪'));
    assert.ok(!prompt.includes('萌宠信使') && !prompt.includes('desktop pet courier'), 'not the courier template');
    assert.ok(!prompt.includes('你现在是《DOTA 2》中的英雄') && !prompt.includes('legendary DOTA 2 hero'), 'not the hero template');
    const plain = new CloudVoiceEngine({ provider, currentHero: persona }).getHeroSystemPrompt();
    assert.ok(plain.includes(provider === 'cartesia' ? 'created themselves' : '召唤师亲手创造'), 'works without a persona too');
  }
});
