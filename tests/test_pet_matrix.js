import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

console.log('=== Starting DOTA 2 VoiceSpirit Companion Pet Matrix & Live2D Test Suite ===\n');

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

async function runTests() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const petsBaseDir = path.join(__dirname, '../src/renderer/assets/pets');

  const petKeys = [
    'aurora_wolf',
    'donkey_courier',
    'treant_sapling',
    'mischievous_greevil',
    'baby_roshan',
  ];

  const requiredStates = [
    'idle', 'walk', 'pet', 'drag', 'feed_tango',
    'feed_salve', 'feed_rapier', 'fetch', 'sleep',
    'think', 'speak', 'special'
  ];

  // 1. Test Pet Matrix Manifests & Asset Files
  for (const petName of petKeys) {
    test(`Pet package [${petName}] has valid manifest & all 12 SVG states`, () => {
      const petDir = path.join(petsBaseDir, petName);
      assert.ok(fs.existsSync(petDir), `Directory missing: ${petDir}`);

      const manifestPath = path.join(petDir, 'pet.json');
      assert.ok(fs.existsSync(manifestPath), `Manifest missing: ${manifestPath}`);

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.strictEqual(manifest.name, petName);
      assert.ok(manifest.displayName, 'Missing displayName');
      assert.ok(manifest.themeColor, 'Missing themeColor');
      assert.ok(manifest.specialSkill, 'Missing specialSkill');
      assert.ok(manifest.specialSkill.id, 'Missing specialSkill.id');
      assert.ok(manifest.specialSkill.name, 'Missing specialSkill.name');
      assert.ok(manifest.specialSkill.duration > 0, 'specialSkill duration must be positive');

      for (const st of requiredStates) {
        assert.ok(manifest.states[st], `Missing state definition [${st}] in ${petName}`);
        const svgFile = manifest.states[st].svg || `${st}.svg`;
        const svgPath = path.join(petDir, svgFile);
        assert.ok(fs.existsSync(svgPath), `Missing SVG asset file: ${svgPath}`);
        const content = fs.readFileSync(svgPath, 'utf8');
        assert.ok(content.includes('<svg'), `Invalid SVG header in ${svgFile}`);
        assert.ok(content.includes('</svg>'), `Invalid SVG footer in ${svgFile}`);
      }
    });
  }

  // 2. Test Live2D Interpolator Spring Physics
  const { DampedSpring, Live2DInterpolator } = await import('../src/renderer/petEngine/Live2DInterpolator.js');

  test('DampedSpring harmonic oscillator converges stably without exploding or NaN', () => {
    const spring = new DampedSpring(160, 16);
    spring.setTarget(10);
    spring.impulse(50);

    for (let i = 0; i < 200; i++) {
      const val = spring.update(0.016);
      assert.ok(!isNaN(val), `Spring produced NaN at step ${i}`);
      assert.ok(isFinite(val), `Spring produced non-finite at step ${i}`);
    }

    // After 200 steps (3.2s), it should settle very close to the target of 10
    assert.ok(Math.abs(spring.value - 10) < 0.1, `Spring did not converge to target: ${spring.value}`);
  });

  test('Live2DInterpolator computes harmonic breath, blinking, and gaze tracking', () => {
    const interpolator = new Live2DInterpolator({ breathPeriod: 3.0 });
    
    // Simulate 60 frames (1 second)
    for (let f = 0; f < 60; f++) {
      interpolator.update(1 / 60);
      assert.ok(interpolator.params.ParamBreath >= 0 && interpolator.params.ParamBreath <= 1.0, 
        `Breath out of range [0,1]: ${interpolator.params.ParamBreath}`);
      assert.ok(interpolator.params.ParamEyeOpen >= 0 && interpolator.params.ParamEyeOpen <= 1.0,
        `Eye openness out of range [0,1]: ${interpolator.params.ParamEyeOpen}`);
      assert.ok(!isNaN(interpolator.params.ParamAngleX), 'ParamAngleX is NaN');
      assert.ok(!isNaN(interpolator.params.ParamAngleY), 'ParamAngleY is NaN');
    }

    // Test squash impact impulse
    interpolator.triggerSquashImpact(0.3);
    interpolator.update(0.016);
    assert.ok(interpolator.params.ParamSquashX > 1.0, 'SquashX should be > 1.0 on impact');
    assert.ok(interpolator.params.ParamSquashY < 1.0, 'SquashY should be < 1.0 on impact');

    // Test Joy Wiggle
    interpolator.triggerJoyWiggle();
    assert.ok(Math.abs(interpolator.params.ParamSpringEar) > 0 || Math.abs(interpolator.springEar.velocity) > 0, 
      'Ear spring should have impulse');
  });

  // 3. Test CodexPetLoader
  const { CodexPetLoader } = await import('../src/renderer/petEngine/CodexPetLoader.js');

  test('CodexPetLoader normalizes manifest packages and resolves state assets', () => {
    const loader = new CodexPetLoader();
    const rawManifest = {
      name: 'test_pet',
      displayName: '测试小宠',
      themeColor: '#10b981',
      specialSkill: { id: 'test_skill', name: '测试绝招', duration: 2000 },
      states: {
        idle: { label: '待命', svg: 'idle.svg', quote: '测试待命' },
        special: { label: '绝招', svg: 'special.svg', quote: '放绝招啦' }
      }
    };

    const pkg = loader.normalizePetPackage(rawManifest, 'assets/pets/test_pet');
    loader.loadedPets.set(pkg.name, pkg);

    assert.strictEqual(pkg.name, 'test_pet');
    assert.strictEqual(pkg.specialSkill.name, '测试绝招');
    assert.strictEqual(pkg.states.idle.svg, 'assets/pets/test_pet/idle.svg');

    const asset = loader.getPetStateAsset('test_pet', 'special');
    assert.strictEqual(asset.src, 'assets/pets/test_pet/special.svg');
    assert.strictEqual(asset.quote, '放绝招啦');
  });

  // 4. Test PetStateMachine State Transitions & Pet Matrix
  const { PetStateMachine } = await import('../src/renderer/petEngine/PetStateMachine.js');

  test('PetStateMachine switches pets and manages GSI combat states & special skills', () => {
    let quotesTriggered = [];
    let petsChanged = [];

    const mockRoot = { style: { setProperty: () => {} } };
    const mockAvatar = {
      src: '',
      style: { transform: '' },
      classList: { add: () => {}, remove: () => {} },
      getBoundingClientRect: () => ({ left: 50, top: 50, width: 100, height: 100 }),
      addEventListener: () => {},
    };

    const sm = new PetStateMachine({
      container: mockRoot,
      avatarEl: mockAvatar,
      statusTextEl: { textContent: '' },
      statusPillEl: { className: '', style: {} },
      onQuote: (q, pet) => quotesTriggered.push({ q, pet: pet?.name }),
      onPetChanged: (pet) => petsChanged.push(pet?.name),
    });

    // Populate loaded pets directly
    for (const p of petKeys) {
      const manifestPath = path.join(petsBaseDir, p, 'pet.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const pkg = sm.loader.normalizePetPackage(manifest, `assets/pets/${p}`);
      sm.loader.loadedPets.set(p, pkg);
    }

    sm.setPetMode(true);
    assert.strictEqual(sm.isPetMode, true);

    // Switch to donkey_courier
    sm.switchPet('donkey_courier');
    assert.strictEqual(sm.currentPetName, 'donkey_courier');
    assert.strictEqual(sm.currentState, 'idle');
    assert.strictEqual(mockAvatar.src, 'assets/pets/donkey_courier/idle.svg');
    assert.ok(petsChanged.includes('donkey_courier'), 'onPetChanged callback should fire');

    // Switch to treant_sapling
    sm.switchPet('treant_sapling');
    assert.strictEqual(sm.currentPetName, 'treant_sapling');
    assert.strictEqual(mockAvatar.src, 'assets/pets/treant_sapling/idle.svg');

    // Feed Tango
    sm.feedItem('tango');
    assert.strictEqual(sm.currentState, 'feed_tango');
    assert.strictEqual(mockAvatar.src, 'assets/pets/treant_sapling/feed_tango.svg');

    // Trigger Special Skill
    sm.triggerSpecialSkill();
    assert.strictEqual(sm.currentState, 'special');
    assert.strictEqual(mockAvatar.src, 'assets/pets/treant_sapling/special.svg');

    // Combat Rampage reaction
    sm.onRampage();
    assert.strictEqual(sm.currentState, 'feed_rapier');
    assert.strictEqual(mockAvatar.src, 'assets/pets/treant_sapling/feed_rapier.svg');

    // Combat Death reaction
    sm.onHeroDeath();
    assert.strictEqual(sm.currentState, 'sleep');
    assert.strictEqual(mockAvatar.src, 'assets/pets/treant_sapling/sleep.svg');

    // Low health reaction
    sm.onLowHealthAlert();
    assert.strictEqual(sm.currentState, 'drag');
    assert.strictEqual(mockAvatar.src, 'assets/pets/treant_sapling/drag.svg');
  });

  // 5. REGRESSION: transient states schedule their exit through ONE shared
  // timer handle and setState cancels a superseding timer. Previously each
  // reaction kept its own anonymous setTimeout, so a stale "return to idle"
  // fired mid-way through a newer state and cut animations short.
  test('a superseding state cancels the stale auto-return timer (no ghost idle)', async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const mockRoot = { style: { setProperty: () => {} } };
    const mockAvatar = {
      src: '',
      style: { transform: '' },
      classList: { add: () => {}, remove: () => {} },
      getBoundingClientRect: () => ({ left: 50, top: 50, width: 100, height: 100 }),
      addEventListener: () => {},
    };

    const sm = new PetStateMachine({
      container: mockRoot,
      avatarEl: mockAvatar,
      statusTextEl: { textContent: '' },
      statusPillEl: { className: '', style: {} },
      onQuote: () => {},
      onPetChanged: () => {},
    });

    const petKeys = ['aurora_wolf', 'donkey_courier', 'treant_sapling', 'mischievous_greevil', 'baby_roshan'];
    for (const p of petKeys) {
      const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/renderer/assets/pets', p, 'pet.json'), 'utf8'));
      const pkg = sm.loader.normalizePetPackage(manifest, `assets/pets/${p}`);
      sm.loader.loadedPets.set(p, pkg);
    }

    sm.setPetMode(true);

    // Kill streak parks the pet in 'pet' with a 2000ms auto-return...
    sm.onKillStreak('double');
    assert.strictEqual(sm.currentState, 'pet');
    await sleep(50);

    // ...then a feed supersedes it with a 2800ms exit.
    sm.feedItem('tango');
    assert.strictEqual(sm.currentState, 'feed_tango');

    // 2200ms in: the stale kill-streak timer must NOT have forced 'idle'.
    await sleep(2150);
    assert.strictEqual(
      sm.currentState,
      'feed_tango',
      'stale auto-return must be cancelled by the superseding state'
    );

    // Feed exit lands normally.
    await sleep(900);
    assert.strictEqual(sm.currentState, 'idle');
  });

  // 6. Dragging stabilization: mouse tracking pauses on drag start and resumes on land
  test('Live2D mouse tracking pauses cleanly on drag start and restores on land', () => {
    const live2d = new Live2DInterpolator();
    assert.strictEqual(live2d.isMouseTracking, true);

    live2d.mouseScreenX = 150;
    live2d.mouseScreenY = 200;
    live2d.springGazeX.target = 10;
    live2d.springGazeY.target = 5;

    // Pause on drag
    live2d.pauseMouseTracking(true);
    assert.strictEqual(live2d.isMouseTracking, false);
    assert.strictEqual(live2d.mouseScreenX, null);
    assert.strictEqual(live2d.mouseScreenY, null);
    assert.strictEqual(live2d.springGazeX.target, 0);
    assert.strictEqual(live2d.springGazeY.target, 0);

    // Resume on landing
    live2d.pauseMouseTracking(false);
    assert.strictEqual(live2d.isMouseTracking, true);
  });

  test('PetStateMachine drag start pauses Live2D tracking and land restores it', () => {
    const mockRoot = { style: { setProperty: () => {} } };
    const mockAvatar = {
      src: '',
      style: { transform: '' },
      classList: { add: () => {}, remove: () => {} },
      getBoundingClientRect: () => ({ left: 50, top: 50, width: 100, height: 100 }),
      addEventListener: () => {},
    };

    const sm = new PetStateMachine({
      container: mockRoot,
      avatarEl: mockAvatar,
      statusTextEl: { textContent: '' },
      statusPillEl: { className: '', style: {} },
    });

    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/renderer/assets/pets/aurora_wolf/pet.json'), 'utf8'));
    const pkg = sm.loader.normalizePetPackage(manifest, 'assets/pets/aurora_wolf');
    sm.loader.loadedPets.set('aurora_wolf', pkg);

    sm.setPetMode(true);
    assert.strictEqual(sm.live2d.isMouseTracking, true);

    // Drag start
    sm.onDragStart();
    assert.strictEqual(sm.isDragging, true);
    assert.strictEqual(sm.currentState, 'drag');
    assert.strictEqual(sm.live2d.isMouseTracking, false, 'live2d mouse tracking must pause during drag');

    // Land
    sm.onDragEnd();
    sm.onLanded();
    assert.strictEqual(sm.isDragging, false);
    assert.strictEqual(sm.currentState, 'idle');
    assert.strictEqual(sm.live2d.isMouseTracking, true, 'live2d mouse tracking must resume after land');
  });

  console.log(`\n=== Test Results: ${passedTests}/${totalTests} Passed ===`);
  if (passedTests === totalTests) {
    console.log('All Pet Matrix & Live2D tests passed successfully!\n');
    process.exit(0);
  } else {
    console.error('Some tests failed!\n');
    process.exit(1);
  }
}

runTests();
