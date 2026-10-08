import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { VoiceSpiritClient } from '../src/services/voiceSpiritClient.js';
import { CloudVoiceEngine } from '../src/services/cloudVoiceEngine.js';

console.log('=== Starting Lazy Voice Connect Test Suite ===\n');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

// Root cause pinned here: the companion used to dial a cloud provider the
// moment it launched — VoiceSpiritClient hardcoded `provider: 'doubao'` and
// setupServices() called voiceClient.connect() unconditionally, so a fresh
// start opened a billed Doubao duplex session with zero user action.
// Startup must stay silent until an explicit provider selection happens.

// Test 1: the client must not invent a provider — the engine default
// (env override -> cartesia) is the single source of truth.
test('VoiceSpiritClient without an explicit provider never defaults to Doubao', () => {
  const savedProvider = process.env.VOICE_PROVIDER;
  delete process.env.VOICE_PROVIDER;
  try {
    const client = new VoiceSpiritClient({});
    assert.strictEqual(client.cloudEngine.provider, 'cartesia', 'engine default must be cartesia, not doubao');
  } finally {
    if (savedProvider !== undefined) process.env.VOICE_PROVIDER = savedProvider;
  }
});

// Test 2: construction must open nothing — no socket, no heartbeat, no
// reconnect timer armed before any explicit connect().
test('Constructing the client opens no connection', () => {
  const client = new VoiceSpiritClient({});
  assert.strictEqual(client.isConnected, false);
  assert.strictEqual(client.cloudEngine.isConnected, false);
  assert.strictEqual(client.cloudEngine.ws, null);
  assert.strictEqual(client.cloudEngine.reconnectTimer, null);
  assert.strictEqual(client.cloudEngine.heartbeatTimer, null);
});

// Test 3: a bare engine is equally inert.
test('CloudVoiceEngine without options starts inert', () => {
  const savedProvider = process.env.VOICE_PROVIDER;
  delete process.env.VOICE_PROVIDER;
  try {
    const engine = new CloudVoiceEngine({});
    assert.strictEqual(engine.provider, 'cartesia');
    assert.strictEqual(engine.isConnected, false);
    assert.strictEqual(engine.ws, null);
  } finally {
    if (savedProvider !== undefined) process.env.VOICE_PROVIDER = savedProvider;
  }
});

// Test 4: with no session, mic audio must be a silent no-op — never a
// crash and never a dial-out.
test('sendAudioChunk is a safe no-op while disconnected', () => {
  const client = new VoiceSpiritClient({});
  const chunks = [];
  client.on('agent_audio_chunk', (data) => chunks.push(data));
  client.sendAudioChunk(new Int16Array(64).buffer);
  client.sendAudioChunk('');
  assert.strictEqual(chunks.length, 0, 'no audio may be relayed while disconnected');
  assert.strictEqual(client.cloudEngine.isConnected, false);
  assert.strictEqual(client.cloudEngine.ws, null);
});

// Test 5: interrupt / disconnect before any connect must be safe no-ops.
test('interrupt and disconnect are safe before any connection', () => {
  const client = new VoiceSpiritClient({});
  let interrupted = 0;
  client.on('interrupted', () => interrupted++);
  client.interrupt();
  client.disconnect();
  assert.ok(interrupted >= 1, 'interrupted event still relayed');
  assert.strictEqual(client.cloudEngine.isConnected, false);
  assert.strictEqual(client.cloudEngine.ws, null);
});

// Test 6: the tray "断开" path — selecting no provider must tear down
// instead of letting the engine fall through to its default pipeline.
test('setProvider(null) disconnects instead of dialing a default pipeline', () => {
  const client = new VoiceSpiritClient({});
  client.setProvider(null);
  client.setProvider(undefined);
  client.setProvider('');
  assert.strictEqual(client.cloudEngine.isConnected, false);
  assert.strictEqual(client.cloudEngine.ws, null);
  assert.strictEqual(client.cloudEngine.reconnectTimer, null);
});

// Startup must remain offline even with a remembered provider or developer environment.
test('main process never connects cloud voice automatically at startup', () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, '../src/main/index.js'), 'utf8');
  const services = mainSrc.slice(mainSrc.indexOf('function setupServices()'), mainSrc.indexOf('function setupIPC()'));
  assert.ok(!services.includes('voiceClient.connect()'));
  assert.ok(mainSrc.includes('let currentVoiceProvider = null;'));
  const startup = mainSrc.slice(mainSrc.indexOf('// App lifecycle'), mainSrc.indexOf("app.on('activate'"));
  assert.ok(!startup.includes('openAISettings()'), 'starting the companion must not open an AI setup window');
});

console.log(`\n=== Test Results: ${passedTests}/${totalTests} Passed ===`);
if (passedTests !== totalTests) {
  process.exit(1);
}
