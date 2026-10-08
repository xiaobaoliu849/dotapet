import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DEFAULT_SIMPLIFIED_PHRASES } from '../src/main/index.js';
import { TranslationService, DOTA_GLOSSARY } from '../src/services/translationService.js';

describe('Quick Phrases Panel & Simplified Presets Test Suite', () => {
  it('should provide 10 simplified, punchy default phrases', () => {
    assert.strictEqual(DEFAULT_SIMPLIFIED_PHRASES.length, 10);
    DEFAULT_SIMPLIFIED_PHRASES.forEach((item, index) => {
      assert.ok(item.cn && item.cn.length > 0, `Phrase ${index} must have Chinese text`);
      assert.ok(item.en && item.en.length > 0, `Phrase ${index} must have English text`);
      assert.ok(item.cn.length <= 20, `Phrase ${index} Chinese should be concise (<= 20 chars)`);
      assert.ok(item.en.split(' ').length <= 10, `Phrase ${index} English should be punchy (<= 10 words)`);
    });
  });

  it('should have DOTA glossary entries for quick tactical replacements', () => {
    assert.strictEqual(DOTA_GLOSSARY['肉山'], 'Roshan');
    assert.strictEqual(DOTA_GLOSSARY['黑皇杖'], 'Black King Bar');
    assert.strictEqual(DOTA_GLOSSARY['bkb'], 'BKB');
  });

  it('should initialize TranslationService and analyze tactical chat', async () => {
    const service = new TranslationService();
    const result = await service.analyzeText('go rosh now');
    assert.ok(result);
    assert.ok(result.translated || result.meaningZh);
  });
});
