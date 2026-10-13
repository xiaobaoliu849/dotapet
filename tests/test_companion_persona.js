import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CustomizationStore } from '../src/main/customizationStore.js';
import { normalizeProfile, PERSONA_MAX_LENGTH } from '../src/services/appearance.js';
import { applyPersonaOverride, personaForKey } from '../src/services/personaOverride.js';
import { CloudVoiceEngine } from '../src/services/cloudVoiceEngine.js';
import { buildPetPseudoHero } from '../src/services/petPersona.js';

const TSUNDERE = '傲娇毒舌，嘴上嫌弃召唤师，其实很关心他。\n说话爱用"哼"开头。';
function store(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new CustomizationStore(directory);
}

test('persona is normalized: trimmed, capped, control characters dropped, newlines kept', () => {
  assert.equal(normalizeProfile().persona, '');
  assert.equal(normalizeProfile({ persona: 42 }).persona, '');
  assert.equal(normalizeProfile({ persona: '   \n ' }).persona, '');
  assert.equal(normalizeProfile({ persona: ` ${TSUNDERE}\u0007 ` }).persona, TSUNDERE);
  assert.equal(normalizeProfile({ persona: 'x'.repeat(PERSONA_MAX_LENGTH + 50) }).persona.length, PERSONA_MAX_LENGTH);
  assert.equal(normalizeProfile({ persona: 'a\tb' }).persona, 'a\tb');
});

test('persona is saved per character and survives a restart; legacy profiles read as empty', t => {
  const s = store(t);
  s.saveProfile('pet:baby_roshan', { persona: TSUNDERE });
  s.data.profiles['hero:invoker'] = { appearance: {}, background: {}, accent: null }; s.persist();
  const reloaded = new CustomizationStore(s.directory);
  assert.equal(personaForKey(reloaded.data.profiles, 'pet:baby_roshan'), TSUNDERE);
  assert.equal(personaForKey(reloaded.data.profiles, 'hero:invoker'), '');
  assert.equal(personaForKey(reloaded.data.profiles, 'hero:missing'), '');
});

test('presets carry the look, never the persona', t => {
  const s = store(t);
  const preset = s.savePreset('Moon', { appearance: { scale: 1.2 }, persona: TSUNDERE });
  assert.equal(preset.profile.persona, '');
  s.data.presets[0].profile.persona = 'legacy'; // a preset saved by hand still exports without it
  const bundle = s.exportPreset(preset.id);
  assert.equal(bundle.profile.persona, '');
  const imported = store(t).importPreset({ ...bundle, profile: { ...bundle.profile, persona: 'smuggled' } });
  assert.equal(imported.profile.persona, '');
  assert.equal(imported.profile.appearance.scale, 1.2);
});

test('override copies the persona object and leaves the shared hero config untouched', () => {
  const hero = Object.freeze({ id: 'invoker', nameZh: '祈求者', systemPrompt: '高傲的大魔导师', catchphrases: ['吾乃魔法之极！'] });
  assert.equal(applyPersonaOverride(hero, ''), hero);
  assert.equal(applyPersonaOverride(hero, '   '), hero);
  assert.equal(applyPersonaOverride(null, TSUNDERE), null);
  const custom = applyPersonaOverride(hero, TSUNDERE);
  assert.notEqual(custom, hero);
  assert.equal(custom.customPersona, TSUNDERE);
  assert.equal(custom.systemPrompt, hero.systemPrompt);
  assert.deepEqual(custom.catchphrases, hero.catchphrases);
});

const hero = { id: 'invoker', nameZh: '祈求者', nameEn: 'Invoker', systemPrompt: '高傲的大魔导师', catchphrases: ['吾乃魔法之极！'] };
const pet = buildPetPseudoHero({ name: 'baby_roshan', displayName: '肉山宝宝 (Baby Roshan)', description: '最爱啃奶酪', catchphrases: ['嗷呜~'] });
const companion = { id: 'companion', nameZh: '自由伴侣', nameEn: 'Free Chat' };

test('custom persona replaces the built-in lore for heroes and pets, in both prompt languages', () => {
  for (const provider of ['doubao', 'cartesia']) {
    for (const base of [hero, pet]) {
      const engine = new CloudVoiceEngine({ provider, currentHero: applyPersonaOverride(base, TSUNDERE) });
      const prompt = engine.getHeroSystemPrompt();
      assert.ok(prompt.includes(TSUNDERE), `${provider}/${base.id} carries the persona`);
      assert.ok(!prompt.includes(base.systemPrompt), `${provider}/${base.id} drops the built-in lore`);
      assert.equal(prompt.split(TSUNDERE).length, 2, 'persona text appears once');
      assert.match(prompt, provider === 'cartesia' ? /overrides any default personality/ : /以它为准/);
    }
  }
});

test('free chat, which has no lore slot, gets the persona text appended', () => {
  for (const provider of ['doubao', 'cartesia']) {
    const engine = new CloudVoiceEngine({ provider, currentHero: applyPersonaOverride(companion, TSUNDERE) });
    const prompt = engine.getHeroSystemPrompt();
    assert.ok(prompt.includes(TSUNDERE));
    assert.ok(prompt.includes(provider === 'cartesia' ? 'FREE CHAT' : '不扮演任何英雄'), 'free-chat routing rules kept');
  }
});

test('without a persona every prompt is exactly the built-in one', () => {
  for (const base of [hero, pet, companion]) {
    const plain = new CloudVoiceEngine({ provider: 'doubao', currentHero: base }).getHeroSystemPrompt();
    const overridden = new CloudVoiceEngine({ provider: 'doubao', currentHero: applyPersonaOverride(base, '') }).getHeroSystemPrompt();
    assert.equal(overridden, plain);
    assert.ok(!plain.includes('召唤师定制的角色设定'));
  }
});

test('who the companion is (persona) and who the user is (nickname) stay separate', () => {
  const engine = new CloudVoiceEngine({ provider: 'qwen', currentHero: applyPersonaOverride(pet, TSUNDERE),
    conversationPreferences: { preferredAddress: '队长', customInstructions: '' } });
  const prompt = engine.getHeroSystemPrompt();
  const persona = prompt.indexOf(TSUNDERE), address = prompt.indexOf('Preferred form of address: "队长"');
  assert.ok(persona >= 0 && address > persona, 'the nickname is still appended after the persona');
});

test('Doubao restarts session with restarting flag when persona changes mid-call', () => {
  const engine = new CloudVoiceEngine({ provider: 'doubao', currentHero: hero });
  engine.isConnected = true;
  let restarts = 0;
  engine.restartSession = () => { restarts++; };
  engine.setHero(applyPersonaOverride(hero, '我是ame'));
  assert.equal(restarts, 1, 'Doubao must restart session to apply new persona prompt');
});

test('custom character with Ame persona enforces first-person identity over generic assistant', () => {
  const custom = buildPetPseudoHero({ name: 'custom_12345678', displayName: '哥哥', description: '' });
  const engine = new CloudVoiceEngine({ provider: 'doubao', currentHero: applyPersonaOverride(custom, '我是ame') });
  const prompt = engine.getHeroSystemPrompt();
  assert.ok(prompt.includes('我是ame'));
  assert.ok(prompt.includes('哥哥'));
  assert.ok(prompt.includes('当设定指明具体人物、身份、性格或特定人设时，你即拥有该身份与人设'));
  assert.ok(prompt.includes('切勿以泛化的“桌面伴侣/助手”套话自称'));
});

