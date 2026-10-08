import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CloudVoiceEngine } from '../src/services/cloudVoiceEngine.js';
import { buildPetPseudoHero, extractPetCatchphrases, PET_PERSONA_KIND } from '../src/services/petPersona.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('=== Starting Desktop Pet Voice Persona Test Suite ===\n');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
  }
}

function loadDonkeyManifest() {
  const petJsonPath = path.resolve(__dirname, '../src/renderer/assets/pets/donkey_courier/pet.json');
  return JSON.parse(fs.readFileSync(petJsonPath, 'utf8'));
}

// Bug under test: the summoner selects the courier pet (信使小驴), starts a
// voice chat, and the engine still speaks as the last-equipped hero. The
// persona bridge + prompt branch must make the pet speak.

test('buildPetPseudoHero maps the real donkey_courier manifest into a pet persona', () => {
  const pet = buildPetPseudoHero(loadDonkeyManifest());
  assert.ok(pet, 'persona should build from the shipped manifest');
  assert.strictEqual(pet.id, 'pet:donkey_courier');
  assert.strictEqual(pet.kind, PET_PERSONA_KIND);
  assert.strictEqual(pet.nameZh, '经典信使 · 小毛驴 (Donkey)');
  assert.strictEqual(pet.nameEn, 'Donkey');
  assert.strictEqual(pet.attribute, 'pet');
  assert.strictEqual(pet.themeColor, '#f59e0b');
  assert.ok(pet.systemPrompt.includes('信使'), 'description becomes the persona lore');
  assert.ok(Array.isArray(pet.catchphrases) && pet.catchphrases.length > 0, 'catchphrases extracted from state quotes');
  assert.ok(pet.catchphrases.some((q) => q.includes('咿昂')), 'donkey vocal tic survives extraction');
});

test('buildPetPseudoHero accepts the lean renderer-synced payload and caps catchphrases', () => {
  const pet = buildPetPseudoHero({
    name: 'aurora_wolf',
    displayName: '极光幼狼 (Aurora Wolf)',
    description: '北风雪原的小狼崽',
    themeColor: '#38bdf8',
    catchphrases: ['嗷呜~', '嗷呜~', ' ', '跟我来！', 'a', 'b', 'c', 'd', 'e'],
  });
  assert.strictEqual(pet.id, 'pet:aurora_wolf');
  assert.strictEqual(pet.nameEn, 'Aurora Wolf');
  assert.strictEqual(pet.catchphrases.length, 6, 'capped at 6');
  assert.ok(pet.catchphrases.includes('嗷呜~'), 'deduped');
  assert.ok(!pet.catchphrases.includes(' '), 'blank quotes dropped');
});

test('Renderer payload contract: extractPetCatchphrases + lean fields keeps per-pet quotes', () => {
  // Mirrors syncPetPersonaToMain exactly. Regression for the shipped-path bug
  // where the payload dropped quotes and every pet spoke the fallback tic.
  const manifest = loadDonkeyManifest();
  const payload = {
    name: manifest.name,
    displayName: manifest.displayName,
    description: manifest.description,
    themeColor: manifest.themeColor,
    catchphrases: extractPetCatchphrases(manifest),
  };
  const pet = buildPetPseudoHero(payload);
  assert.ok(pet.catchphrases.length > 0, 'lean payload must still carry quotes');
  assert.ok(pet.catchphrases.some((q) => q.includes('咿昂')), 'donkey tic survives the lean path');
});

test('buildPetPseudoHero falls back for a nameless displayName and rejects garbage', () => {
  const pet = buildPetPseudoHero({ name: 'mystery_pet', displayName: '神秘萌宠' });
  assert.strictEqual(pet.nameEn, 'mystery_pet', 'no paren tail -> falls back to pet name');
  assert.strictEqual(buildPetPseudoHero(null), null);
  assert.strictEqual(buildPetPseudoHero({}), null);
  assert.strictEqual(buildPetPseudoHero({ name: '  ' }), null);
});

test('Pet persona prompt: bilingual route speaks as the pet, never as a hero', () => {
  const engine = new CloudVoiceEngine({ provider: 'doubao' });
  engine.setHero(buildPetPseudoHero(loadDonkeyManifest()));
  const prompt = engine.getHeroSystemPrompt();
  assert.ok(prompt.includes('萌宠信使'), 'pet branch triggers');
  assert.ok(prompt.includes('经典信使 · 小毛驴 (Donkey)'), 'pet display name embedded');
  assert.ok(prompt.includes('战场功勋信使'), 'manifest lore embedded');
  assert.ok(prompt.includes('不要把自己扮成英雄'), 'anti-hero-drift rule present');
  assert.ok(!prompt.includes('你现在是《DOTA 2》中的英雄'), 'hero template must not leak into pet persona');
  assert.ok(!prompt.includes('不扮演任何英雄'), 'free-chat template must not leak into pet persona');
});

test('Pet persona prompt: English route stays the pet with pure-English rule', () => {
  const engine = new CloudVoiceEngine({ provider: 'cartesia' });
  engine.setHero(buildPetPseudoHero(loadDonkeyManifest()));
  const prompt = engine.getHeroSystemPrompt();
  assert.ok(prompt.includes('desktop pet courier'), 'english pet branch triggers');
  assert.ok(prompt.includes('Donkey'), 'english name embedded');
  assert.ok(prompt.includes('PURE ENGLISH REQUIREMENT'), 'pure english rule kept');
  assert.ok(!prompt.includes('legendary DOTA 2 hero'), 'hero template must not leak');
});

test('Pet persona prompt: forced en mode on a bilingual provider also uses the pet english variant', () => {
  const engine = new CloudVoiceEngine({ provider: 'doubao' });
  engine.setHero(buildPetPseudoHero(loadDonkeyManifest()));
  const prompt = engine.getHeroSystemPrompt('en');
  assert.ok(prompt.includes('desktop pet courier'));
  assert.ok(!prompt.includes('legendary DOTA 2 hero'));
});

test('Real-hero persona still locks the hero template (regression guard)', () => {
  const engine = new CloudVoiceEngine({ provider: 'doubao' });
  engine.setHero({
    id: 'invoker',
    nameZh: '祈求者',
    nameEn: 'Invoker',
    systemPrompt: '高傲自信的大魔导师',
    catchphrases: ['吾乃魔法之极！'],
  });
  const prompt = engine.getHeroSystemPrompt();
  assert.ok(prompt.includes('英雄【祈求者 (Invoker)】'), 'hero template intact');
  assert.ok(!prompt.includes('萌宠信使'), 'pet branch must not hijack real heroes');
});

test('Free-chat companion persona unaffected by pet branch (regression guard)', () => {
  const engine = new CloudVoiceEngine({ provider: 'doubao' });
  engine.setHero({ id: 'companion', nameZh: '自由伴侣', nameEn: 'Free Chat' });
  const prompt = engine.getHeroSystemPrompt();
  assert.ok(prompt.includes('不扮演任何英雄'), 'free-chat prompt intact');
  assert.ok(!prompt.includes('萌宠信使'), 'pet branch must not hijack free chat');
});

const summary = `\n=== Pet Persona Tests: ${passedTests}/${totalTests} passed ===`;
console.log(summary);
if (passedTests !== totalTests) {
  process.exit(1);
}
