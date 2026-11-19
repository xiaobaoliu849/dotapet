import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { cleanValveText, formatStatNumbers, resolveValveHeading, extractStatsFromMechanics } from '../src/learning/itemDetails.js';

const VALVE_BASE = 'https://www.dota2.com/datafeed/itemdata';
const catalog = JSON.parse(fs.readFileSync(new URL('../src/learning/catalog.json', import.meta.url), 'utf8'));
const items = catalog.lessons.filter(l => l.kind === 'item');

async function fetchJson(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 400 * attempt));
    }
  }
}

function buildOfficialStats(enRec, zhRec, lesson) {
  const enSvs = enRec?.special_values || [];
  const zhByName = new Map((zhRec?.special_values || []).map(v => [v.name, v]));
  const stats = [];
  const seen = new Set();
  for (const sv of enSvs) {
    if (!sv?.heading_loc) continue;
    // Skip active/cooldown/mana parameters that are ability details rather than passive item stat bonuses unless heading starts with + or -
    const rawHeading = String(sv.heading_loc || '').trim();
    if (!/^[+-]/.test(rawHeading)) continue;
    const zhSv = zhByName.get(sv.name);
    const resolved = resolveValveHeading(sv.heading_loc, zhSv?.heading_loc || '');
    if (!resolved) continue;
    const isPct = Boolean(sv.is_percentage || resolved.pct);
    const value = formatStatNumbers(sv.values_float || [], isPct, resolved.sign);
    if (!value) continue;
    const key = `${resolved.en}|${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stats.push({ value, en: resolved.en, zh: resolved.zh });
  }
  if (!stats.length && (!lesson.descriptionEn?.trim())) {
    return extractStatsFromMechanics(lesson);
  }
  return stats;
}

function interpolateNote(raw, rec) {
  const cleaned = cleanValveText(raw);
  if (!cleaned) return '';
  const values = new Map((rec?.special_values || []).map(v => [String(v.name || '').toLowerCase(), v.values_float || []]));
  return cleaned.replace(/%([\w]+)%/g, (token, key) => {
    const k = key.toLowerCase();
    const nums = values.get(k) || values.get(k.replace(/^bonus_/, ''));
    if (!nums?.length) return token;
    const unique = [...new Set(nums.map(n => Math.round(n * 100) / 100))];
    return unique.join(' / ');
  }).replace(/%%/g, '%');
}

const entries = {};
let withStats = 0, withLore = 0, withNotes = 0;

const batchSize = 12;
for (let i = 0; i < items.length; i += batchSize) {
  const chunk = items.slice(i, i + batchSize);
  const rows = await Promise.all(chunk.map(async lesson => {
    const numericId = Number(lesson.id.split(':')[1]);
    if (!Number.isInteger(numericId)) return null;
    const [enJson, zhJson] = await Promise.all([
      fetchJson(`${VALVE_BASE}?language=english&item_id=${numericId}`),
      fetchJson(`${VALVE_BASE}?language=schinese&item_id=${numericId}`),
    ]);
    const enRec = enJson.result?.data?.items?.[0];
    const zhRec = zhJson.result?.data?.items?.[0];
    if (!enRec) return null;
    const stats = buildOfficialStats(enRec, zhRec, lesson);
    const notesEn = (enRec.notes_loc || []).map(n => interpolateNote(n, enRec)).filter(Boolean);
    const notesZh = (zhRec?.notes_loc || []).map(n => interpolateNote(n, zhRec || enRec)).filter(Boolean);
    const loreEn = cleanValveText(enRec.lore_loc || '');
    const loreZh = cleanValveText(zhRec?.lore_loc || '');
    return {
      id: lesson.id,
      entry: {
        en: lesson.en,
        ...(stats.length ? { stats } : {}),
        ...(notesEn.length ? { notesEn } : {}),
        ...(notesZh.length ? { notesZh } : {}),
        ...(loreEn ? { loreEn } : {}),
        ...(loreZh ? { loreZh } : {}),
      },
    };
  }));
  for (const row of rows) {
    if (!row) continue;
    const e = row.entry;
    if (e.stats?.length) withStats++;
    if (e.loreEn || e.loreZh) withLore++;
    if (e.notesEn?.length || e.notesZh?.length) withNotes++;
    if (e.stats?.length || e.loreEn || e.loreZh || e.notesEn?.length || e.notesZh?.length) {
      entries[row.id] = e;
    }
  }
}

const payload = {
  schema: 1,
  fetchedAt: new Date().toISOString(),
  sourceUrl: VALVE_BASE,
  count: Object.keys(entries).length,
  withStats,
  withLore,
  withNotes,
  entries,
};

const jsonText = JSON.stringify(payload, null, 2) + '\n';
const sha256 = createHash('sha256').update(jsonText).digest('hex');
fs.writeFileSync(new URL('../src/learning/item-details.json', import.meta.url), jsonText);
console.log(`Synced official Valve details for ${payload.count}/${items.length} items (stats: ${withStats}, lore: ${withLore}, notes: ${withNotes}, sha256: ${sha256.slice(0, 12)})`);
