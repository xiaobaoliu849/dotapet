import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import electron from 'electron';

const executable = process.argv[2] ? path.resolve(process.argv[2]) : electron;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-smoke-'));
const screenshot = path.join(directory, 'ai-settings.png');
const args = [
  ...(!process.argv[2] ? ['.'] : []), '--companion-smoke-test',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  `--companion-data-dir=${directory}`, `--companion-smoke-output=${screenshot}`,
];
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, args, { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk.toString(); });
const timer = setTimeout(() => child.kill(), 60000);
child.on('error', error => { clearTimeout(timer); console.error(error.message); process.exitCode = 1; });
child.on('close', code => {
  clearTimeout(timer);
  const passed = code === 0 && output.includes('[Smoke] PASS') && fs.existsSync(screenshot);
  console.log(output.trim());
  console.log(`Smoke ${passed ? 'PASS' : 'FAIL'}; isolated screenshot: ${screenshot}`);
  process.exitCode = passed ? 0 : 1;
});
