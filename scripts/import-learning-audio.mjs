import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioCandidates } from '../src/learning/audioAssets.js';

const source = path.resolve(process.argv[2] || 'D:/Projects/dota-2-bilingual-lexicon/public/audio');
const destination = fileURLToPath(new URL('../src/renderer/assets/learning-audio/', import.meta.url));
const catalog = JSON.parse(fs.readFileSync(new URL('../src/learning/catalog.json', import.meta.url), 'utf8'));
const entries = {}, missing = [];
let bytes = 0;
for (const lesson of catalog.lessons) {
  const candidate = audioCandidates(lesson).find(file => {
    const absolute = path.join(source, file);
    return fs.existsSync(absolute) && fs.statSync(absolute).isFile() && fs.statSync(absolute).size > 0;
  });
  if (!candidate) { missing.push({ id: lesson.id, name: lesson.en, kind: lesson.kind }); continue; }
  const [kind, id] = lesson.id.split(':');
  if (!/^[a-z]+$/.test(kind) || !/^[\w-]+$/.test(id)) throw new Error('Unsafe lesson ID');
  const file = `${kind}/${id}.mp3`, target = path.join(destination, file), from = path.join(source, candidate);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(from, target);
  const size = fs.statSync(target).size; bytes += size;
  entries[lesson.id] = { file, name: lesson.en, content: lesson.kind === 'hero' ? 'biography' : lesson.kind === 'phrase' ? 'expression' : 'explanation', sourceFile: candidate, bytes: size };
}
const manifest = { schema: 1, source: 'User-generated AI recordings from Dota 2 Bilingual Lexicon', sourceVersion: '20260329_v4', importedAt: new Date().toISOString(), entries, missing };
fs.writeFileSync(new URL('../src/learning/audio-manifest.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ recordings: Object.keys(entries).length, bytes, missing: missing.length, byKind: Object.keys(entries).reduce((counts, id) => { const kind = id.split(':')[0]; counts[kind] = (counts[kind] || 0) + 1; return counts; }, {}) }, null, 2));
