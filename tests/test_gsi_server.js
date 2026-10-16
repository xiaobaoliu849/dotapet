import http from 'http';
import { GSIServer } from '../src/main/gsi/gsiServer.js';
import { normalizeGsiHeroName } from '../src/main/gsi/heroMap.js';
import { checkGsiInstalled, generateGsiConfigContent } from '../src/main/gsi/gsiInstaller.js';

async function runTests() {
  console.log('=== Starting DOTA 2 GSI Integration Tests ===\n');

  // Test 1: Hero Name Normalization
  console.log('[Test 1] Hero Name Normalization');
  const mockConfigHeroes = {
    invoker: { id: 'invoker', nameZh: '祈求者' },
    anti_mage: { id: 'anti_mage', nameZh: '敌法师' },
    shadow_fiend: { id: 'shadow_fiend', nameZh: '影魔' },
    windranger: { id: 'windranger', nameZh: '风行者' },
    wraith_king: { id: 'wraith_king', nameZh: '冥魂大帝' },
    io: { id: 'io', nameZh: '艾欧' },
  };

  const t1_invoker = normalizeGsiHeroName('npc_dota_hero_invoker', mockConfigHeroes);
  const t1_antimage = normalizeGsiHeroName('npc_dota_hero_antimage', mockConfigHeroes);
  const t1_nevermore = normalizeGsiHeroName('npc_dota_hero_nevermore', mockConfigHeroes);
  const t1_windrunner = normalizeGsiHeroName('npc_dota_hero_windrunner', mockConfigHeroes);
  const t1_wisp = normalizeGsiHeroName('npc_dota_hero_wisp', mockConfigHeroes);

  if (t1_invoker === 'invoker' && t1_antimage === 'anti_mage' && t1_nevermore === 'shadow_fiend' && t1_windrunner === 'windranger' && t1_wisp === 'io') {
    console.log('  ✅ Hero name normalization test passed!');
  } else {
    throw new Error(`Hero normalization failed: invoker=${t1_invoker}, antimage=${t1_antimage}, nevermore=${t1_nevermore}`);
  }

  // Test 2: GSI Config Generator
  console.log('\n[Test 2] GSI Config Generator');
  const cfgContent = generateGsiConfigContent(3008);
  if (cfgContent.includes('http://127.0.0.1:3008/') && cfgContent.includes('"hero"          "1"')) {
    console.log('  ✅ GSI config generation test passed!');
  } else {
    throw new Error('Config generation test failed');
  }

  // Test 3: GSIServer & Event Dispatching
  console.log('\n[Test 3] GSIServer Packet Processing & Event Dispatch');
  const testPort = 3099;
  const server = new GSIServer({
    port: testPort,
    heroesConfig: { heroes: mockConfigHeroes },
  });

  let heroDetected = null;
  let killEvent = null;
  let deathEvent = null;
  let timerAlert = null;

  server.on('hero_detected', (data) => {
    heroDetected = data;
    console.log(`  [Event] Hero Detected: ${data.heroId} (${data.heroData?.nameZh})`);
  });

  server.on('combat_kill', (data) => {
    killEvent = data;
    console.log(`  [Event] Combat Kill: ${data.streakType} - ${data.title}`);
  });

  server.on('combat_death', (data) => {
    deathEvent = data;
    console.log(`  [Event] Combat Death: ${data.title} - ${data.message}`);
  });

  server.on('tactical_timer', (data) => {
    timerAlert = data;
    console.log(`  [Event] Tactical Timer: ${data.title} - ${data.message}`);
  });

  server.start();

  // Helper to send mock HTTP POST
  const sendMockPayload = (payload) => {
    return new Promise((resolve, reject) => {
      const dataStr = JSON.stringify(payload);
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(dataStr),
          },
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', resolve);
        }
      );
      req.on('error', reject);
      req.write(dataStr);
      req.end();
    });
  };

  // Wait for server start
  await new Promise((r) => setTimeout(r, 200));

  // Step 3a: Hero Selection & Start
  console.log('  -> Sending initial game payload with Invoker...');
  await sendMockPayload({
    map: { matchid: '987654321', game_state: 'DOTA_GAMERULES_STATE_PRE_GAME', clock_time: -30 },
    player: { kills: 0, deaths: 0, assists: 0, kill_streak: 0, gold: 600 },
    hero: { name: 'npc_dota_hero_invoker', level: 1, alive: true, health: 600, max_health: 600, health_percent: 100 },
  });

  if (heroDetected?.heroId !== 'invoker') {
    throw new Error(`Hero detection failed, expected invoker got ${heroDetected?.heroId}`);
  }

  // Step 3b: In-Game Kill (Triple kill & Rampage)
  console.log('  -> Sending kill streak payload (Rampage)...');
  await sendMockPayload({
    map: { matchid: '987654321', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 150 },
    player: { kills: 5, deaths: 0, assists: 2, kill_streak: 5, gold: 2400 },
    hero: { name: 'npc_dota_hero_invoker', level: 8, alive: true, health: 900, max_health: 1000, health_percent: 90 },
  });

  if (killEvent?.streakType !== 'rampage') {
    throw new Error(`Kill streak detection failed, expected rampage got ${killEvent?.streakType}`);
  }

  // Step 3c: Death event
  console.log('  -> Sending hero death payload...');
  await sendMockPayload({
    map: { matchid: '987654321', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 160 },
    player: { kills: 5, deaths: 1, assists: 2, kill_streak: 0, gold: 2100 },
    hero: { name: 'npc_dota_hero_invoker', level: 8, alive: false, respawn_seconds: 22, buyback_cost: 450, buyback_cooldown: 0 },
  });

  if (!deathEvent || deathEvent.respawnSeconds !== 22 || !deathEvent.canBuyback) {
    throw new Error('Combat death detection failed');
  }

  // Step 3d: Tactical Timer Alert (At clock_time 165 = 2:45 -> 15s to 3:00 bounty/lotus)
  console.log('  -> Sending clock_time 165 (2:45) for Bounty/Lotus alert...');
  await sendMockPayload({
    map: { matchid: '987654321', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 165 },
    player: { kills: 5, deaths: 1, assists: 2 },
    hero: { name: 'npc_dota_hero_invoker', level: 8, alive: true, health: 1000, max_health: 1000 },
  });

  if (timerAlert?.type !== 'bounty_lotus') {
    throw new Error(`Timer alert failed, expected bounty_lotus got ${timerAlert?.type}`);
  }

  // Step 3e: Clutch Escape (Low HP <= 25% -> gradual heal through 42% -> >= 45% without dying)
  console.log('  -> Sending low HP (18%) followed by gradual heal (42% -> 48%) for Clutch Escape...');
  timerAlert = null;
  await sendMockPayload({
    map: { matchid: '987654321', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 170 },
    player: { kills: 5, deaths: 1, assists: 2 },
    hero: { name: 'npc_dota_hero_invoker', level: 8, alive: true, health: 180, max_health: 1000, health_percent: 18 },
  });
  await sendMockPayload({
    map: { matchid: '987654321', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 172 },
    player: { kills: 5, deaths: 1, assists: 2 },
    hero: { name: 'npc_dota_hero_invoker', level: 8, alive: true, health: 420, max_health: 1000, health_percent: 42 },
  });
  await sendMockPayload({
    map: { matchid: '987654321', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 174 },
    player: { kills: 5, deaths: 1, assists: 2 },
    hero: { name: 'npc_dota_hero_invoker', level: 8, alive: true, health: 480, max_health: 1000, health_percent: 48 },
  });
  if (timerAlert?.type !== 'clutch_escape') {
    throw new Error(`Clutch escape alert failed on gradual heal, expected clutch_escape got ${timerAlert?.type}`);
  }

  // Guard: Low HP -> Death -> Respawn at 100% HP must NOT falsely trigger clutch_escape
  timerAlert = null;
  await sendMockPayload({
    map: { matchid: '987654321', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 180 },
    player: { kills: 5, deaths: 1, assists: 2 },
    hero: { name: 'npc_dota_hero_invoker', level: 8, alive: true, health: 150, max_health: 1000, health_percent: 15 },
  });
  await sendMockPayload({
    map: { matchid: '987654321', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 182 },
    player: { kills: 5, deaths: 2, assists: 2 },
    hero: { name: 'npc_dota_hero_invoker', level: 8, alive: false, health: 0, max_health: 1000, health_percent: 0, respawn_seconds: 25 },
  });
  await sendMockPayload({
    map: { matchid: '987654321', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 210 },
    player: { kills: 5, deaths: 2, assists: 2 },
    hero: { name: 'npc_dota_hero_invoker', level: 8, alive: true, health: 1000, max_health: 1000, health_percent: 100 },
  });
  if (timerAlert?.type === 'clutch_escape') {
    throw new Error('Respawning after dying at low HP must NOT falsely emit clutch_escape');
  }

  // Step 3f: Forgetful Carry No-TP Scroll Warning (10:00+, full HP, teleport0 empty)
  console.log('  -> Sending 10:10 full HP payload with empty teleport0 slot...');
  timerAlert = null;
  await sendMockPayload({
    map: { matchid: '987654321', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 610 },
    player: { kills: 6, deaths: 2, assists: 4 },
    hero: { name: 'npc_dota_hero_invoker', level: 11, alive: true, health: 1200, max_health: 1200, health_percent: 100 },
    items: { teleport0: { name: 'empty' } },
  });
  if (timerAlert?.type !== 'no_tp_warning') {
    throw new Error(`No-TP warning failed, expected no_tp_warning got ${timerAlert?.type}`);
  }

  server.stop();
  console.log('\n🎉 ALL GSI INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
}

runTests().catch((err) => {
  console.error('\n❌ Test run failed:', err);
  process.exit(1);
});
