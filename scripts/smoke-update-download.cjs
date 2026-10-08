// Loopback download + real electron-updater SHA512 verification. Never runs an installer.
const { app } = require('electron');
const { NsisUpdater } = require('electron-updater');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotapet-update-download-'));
app.setPath('userData', directory);
app.disableHardwareAcceleration();
const timeout = setTimeout(() => { console.error('[Update download] Timed out'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  const version = require('../package.json').version;
  const installer = path.resolve(__dirname, `../release/DotaPet-Setup-${version}.exe`);
  const bytes = fs.readFileSync(installer);
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
  const metadata = fs.readFileSync(path.resolve(__dirname, '../release/latest.yml'), 'utf8');
  assert.equal(metadata.match(/^version: (.+)$/m)?.[1], version);
  assert.equal(metadata.match(/^sha512: (.+)$/m)?.[1], sha512);
  assert.equal(metadata.match(/^path: (.+)$/m)?.[1], path.basename(installer));
  assert.ok(fs.existsSync(`${installer}.blockmap`));
  let corrupt = false;
  const server = http.createServer((request, response) => {
    if (request.url.split('?')[0] === '/latest.yml') {
      const hash = corrupt ? Buffer.alloc(64).toString('base64') : sha512;
      response.end(`version: 99.0.${corrupt ? 1 : 0}\nfiles:\n  - url: fixture-${corrupt ? 'bad' : 'good'}.exe\n    sha512: ${hash}\n    size: ${bytes.length}\npath: fixture-${corrupt ? 'bad' : 'good'}.exe\nsha512: ${hash}\n`);
    } else if (/^\/fixture-(good|bad)\.exe(?:\?|$)/.test(request.url)) {
      response.setHeader('Content-Length', bytes.length); response.end(bytes);
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = path.join(directory, 'app-update.yml');
  const url = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(config, `provider: generic\nurl: ${url}\nupdaterCacheDirName: cache\n`);
  const updater = new NsisUpdater({ provider: 'generic', url });
  updater.forceDevUpdateConfig = true;
  updater.updateConfigPath = config;
  Object.defineProperty(updater.app, 'baseCachePath', { get: () => directory });
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.disableDifferentialDownload = true;
  updater.logger = { info() {}, warn() {}, debug() {}, error() {} };
  updater.quitAndInstall = () => { throw new Error('This check must never install'); };
  let verified = 0;
  updater.on('update-downloaded', () => verified++);
  try {
    const result = await updater.checkForUpdates();
    assert.equal(result.isUpdateAvailable, true);
    assert.equal(verified, 0);
    const files = await updater.downloadUpdate();
    assert.equal(verified, 1);
    assert.equal(crypto.createHash('sha512').update(fs.readFileSync(files[0])).digest('base64'), sha512);
    corrupt = true;
    await updater.checkForUpdates();
    await assert.rejects(updater.downloadUpdate(), /checksum|sha512/i);
    assert.equal(verified, 1);
    console.log('[Update download] PASS: real installer downloaded and hashed; corrupt metadata rejected; no installation');
    console.log(`Isolated cache: ${directory}`);
    app.exit(0);
  } finally { clearTimeout(timeout); server.close(); }
}).catch(error => { console.error('[Update download]', error.message); app.exit(1); });
