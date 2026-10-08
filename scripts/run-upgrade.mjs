import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
const [mode, executableOrDirectory, directory] = process.argv.slice(2);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const executable = mode === 'seed' ? electron : executableOrDirectory;
const args = mode === 'seed'
  ? [fileURLToPath(new URL('./seed-upgrade.cjs', import.meta.url)), executableOrDirectory]
  : ['--companion-smoke-test', '--companion-upgrade-check', `--companion-data-dir=${directory}`];
const result = spawnSync(executable, args, { env: environment, windowsHide: true, encoding: 'utf8', timeout: 30000 });
if (result.stdout) console.log(result.stdout.trim());
if (result.stderr) console.error(result.stderr.trim());
process.exitCode = result.status === 0 && (mode === 'seed' || result.stdout.includes('[Upgrade] PASS')) ? 0 : 1;
