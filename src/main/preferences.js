import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export function readPreferences(file, fsImpl = fs) {
  let text;
  try {
    text = fsImpl.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SyntaxError('Preferences must be a JSON object');
  return data;
}

export function writePreferences(file, changes, fsImpl = fs) {
  let current;
  try {
    current = readPreferences(file, fsImpl);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // Keep the unreadable original in place until the replacement commits.
    const backup = `${file}.unreadable-${randomUUID()}.json`;
    fsImpl.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    current = {};
  }

  const next = { ...current, ...changes, updatedAt: new Date().toISOString() };
  const temporary = `${file}.${randomUUID()}.tmp`;
  const descriptor = fsImpl.openSync(temporary, 'wx', 0o600);
  try {
    try {
      fsImpl.writeFileSync(descriptor, JSON.stringify(next, null, 2), { encoding: 'utf8', flush: true });
    } finally {
      fsImpl.closeSync(descriptor);
    }
    fsImpl.renameSync(temporary, file);
  } catch (error) {
    try { fsImpl.unlinkSync(temporary); } catch { /* Preserve the original failure. */ }
    throw error;
  }
}
