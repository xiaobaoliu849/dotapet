import { pairRecords } from './model.js';
import { applyReviewedLocalizations } from './reviewedLocalizations.js';

const BASE = 'https://www.dota2.com/datafeed/';

export async function fetchLatestPatch(fetcher = fetch) {
  try {
    const url = new URL('patchnoteslist', BASE);
    url.search = new URLSearchParams({ language: 'english' });
    const response = await fetcher(url, { signal: AbortSignal.timeout(12000) });
    if (!response?.ok) return { patch: null, patchDate: null, previousPatch: null };
    const json = await response.json();
    const list = Array.isArray(json?.patches) ? json.patches : Array.isArray(json?.result?.data?.patches) ? json.result.data.patches : [];
    const latest = list.at(-1);
    const previous = list.length >= 2 ? list.at(-2) : null;
    const patch = typeof latest?.patch_number === 'string' && latest.patch_number.trim() ? latest.patch_number.trim() : null;
    const previousPatch = typeof previous?.patch_number === 'string' && previous.patch_number.trim() ? previous.patch_number.trim() : null;
    const ts = Number(latest?.patch_timestamp);
    const patchDate = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null;
    return { patch, patchDate, previousPatch };
  } catch {
    return { patch: null, patchDate: null, previousPatch: null };
  }
}

export async function fetchCatalog({ fetcher = fetch, onProgress = () => {} } = {}) {
  let done = 0;
  async function get(endpoint, language, params = {}) {
    const url = new URL(endpoint, BASE);
    url.search = new URLSearchParams({ language, ...params });
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetcher(url, { signal: AbortSignal.timeout(25000) });
        if (!response.ok) throw new Error(`Valve HTTP ${response.status}`);
        const json = await response.json();
        if (!json.result?.data) throw new Error('Unexpected Valve response');
        return json.result.data;
      } catch (error) { last = error; }
    }
    throw last;
  }
  const heroList = (await get('herolist', 'english')).heroes;
  const itemList = (await get('itemlist', 'english')).itemabilities.filter(r => !r.name.startsWith('item_recipe_'));
  if (heroList.length < 100 || itemList.length < 100) throw new Error('Incomplete Valve lists');
  const tasks = [...heroList.map(r => ({ ...r, kind: 'hero' })), ...itemList.map(r => ({ ...r, kind: 'item' }))];
  const output = new Array(tasks.length);
  const omitted = [];
  let cursor = 0;
  let failed = false;
  const workers = await Promise.allSettled(Array.from({ length: 4 }, async () => {
    try {
      while (cursor < tasks.length) {
        if (failed) return;
        const index = cursor++, task = tasks[index], hero = task.kind === 'hero';
        const endpoint = hero ? 'herodata' : 'itemdata', params = { [hero ? 'hero_id' : 'item_id']: String(task.id) };
        const en = await get(endpoint, 'english', params), zh = await get(endpoint, 'schinese', params);
        const a = (hero ? en.heroes : en.items)?.[0], b = (hero ? zh.heroes : zh.items)?.[0];
        if (!a || !b) throw new Error(`Missing ${task.kind} ${task.id}`);
        // Valve's list includes unnamed internal items. They are not learnable names.
        if (!hero && (!a.name_loc || !b.name_loc)) {
          omitted.push({ id: task.id, reason: 'Unnamed internal item in Valve feed' });
          output[index] = []; onProgress({ done: ++done, total: tasks.length }); continue;
        }
        output[index] = hero ? [
          ...pairRecords([{ ...a, desc_loc: a.hype_loc }], [{ ...b, desc_loc: b.hype_loc }], 'hero'),
          ...pairRecords(a.abilities || [], b.abilities || [], 'ability', `${a.name_loc} · ${b.name_loc}`),
        ] : pairRecords([{ ...a, name: task.name }], [b], 'item');
        onProgress({ done: ++done, total: tasks.length });
      }
    } catch (error) { failed = true; throw error; }
  }));
  const failure = workers.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  const lessons = [...new Map(output.flat().map(r => [r.id, r])).values()];
  const { patch, patchDate } = await fetchLatestPatch(fetcher);
  return applyReviewedLocalizations({ schema: 1, fetchedAt: new Date().toISOString(), source: BASE,
    sourceLabel: 'Valve official bilingual data feed', patch, ...(patchDate ? { patchDate } : {}), omitted, lessons });
}
