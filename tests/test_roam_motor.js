import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

console.log('=== Starting DOTA 2 VoiceSpirit Companion Roam Motor Test Suite ===\n');

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

/**
 * RoamMotor lives in the renderer bundle (a classic <script>, so it has no
 * exports). Rather than change how the app loads, lift the class source out of
 * app.js and evaluate it against stubbed DOM globals — the code under test is
 * byte-for-byte what ships.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const classStart = appSrc.indexOf('class RoamMotor {');
const classEnd = appSrc.indexOf('const roamMotor = new RoamMotor();');
assert.ok(classStart > -1 && classEnd > classStart, 'could not locate RoamMotor in app.js');
const motorSource = appSrc.slice(classStart, classEnd);

function createMotor({ cruiseSpeed = 40, accel = 90, decel = 110 } = {}) {
  const frames = [];
  const sent = { moves: [], legComplete: 0, reachedBound: 0 };
  const rootEl = { style: {} };
  const classes = new Set();

  const sandbox = {
    requestAnimationFrame: (cb) => frames.push(cb),
    cancelAnimationFrame: () => frames.length = 0,
    document: {
      body: {
        classList: {
          toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
        },
      },
      getElementById: () => rootEl,
    },
    window: {
      electronAPI: {
        roamApplyX: (x, epoch) => sent.moves.push({ x, epoch }),
        roamLegComplete: () => sent.legComplete++,
        roamReachedBound: () => sent.reachedBound++,
      },
    },
  };

  const context = vm.createContext(sandbox);
  const RoamMotor = vm.runInContext(`${motorSource}\nRoamMotor;`, context);
  const motor = new RoamMotor();

  let ts = 1000;
  // Drive the rAF queue by hand so every test runs on a deterministic clock.
  const pump = (count, dtMs = 1000 / 60) => {
    for (let i = 0; i < count; i++) {
      const cb = frames.shift();
      if (!cb) return i;
      ts += dtMs;
      cb(ts);
    }
    return count;
  };
  const pumpUntil = (predicate, limit = 4000, dtMs = 1000 / 60) => {
    for (let i = 0; i < limit; i++) {
      if (predicate()) return i;
      if (pump(1, dtMs) === 0) return -1;
    }
    return -1;
  };

  const plan = (overrides = {}) => ({
    epoch: 1,
    moving: true,
    x: 500,
    direction: 1,
    cruiseSpeed,
    accel,
    decel,
    legDistance: 200,
    minX: 20,
    maxX: 1600,
    ...overrides,
  });

  return { motor, sent, pump, pumpUntil, plan, classes, rootEl, pending: () => frames.length };
}

test('a stationary plan neither schedules frames nor moves the window', () => {
  const { motor, sent, pending } = createMotor();
  motor.applyPlan({
    epoch: 4, moving: false, x: 500, direction: 1,
    cruiseSpeed: 40, accel: 90, decel: 110, legDistance: 0, minX: 20, maxX: 1600,
  });

  assert.strictEqual(pending(), 0, 'must not run an animation loop while parked');
  assert.strictEqual(sent.moves.length, 0);
  assert.strictEqual(motor.isWalkingVisual, false);
});

test('integer window moves never skip a pixel (no ratcheting)', () => {
  const { motor, sent, pump, plan } = createMotor();
  motor.applyPlan(plan());
  pump(200);

  assert.ok(sent.moves.length > 20, 'expected steady position reports');
  for (let i = 1; i < sent.moves.length; i++) {
    const delta = sent.moves[i].x - sent.moves[i - 1].x;
    assert.strictEqual(delta, 1, `step ${i} moved ${delta}px instead of 1px`);
  }
});

test('the window position tracks the walk within half a pixel, with no in-window transform', () => {
  const { motor, pump, plan, rootEl } = createMotor();
  motor.applyPlan(plan());

  for (let i = 0; i < 240; i++) {
    pump(1);
    assert.ok(Math.abs(motor.x - motor.appliedX) <= 0.5 + 1e-9,
      `window ${motor.appliedX} drifted from walk position ${motor.x}`);
    assert.strictEqual(rootEl.style.transform, undefined,
      'position must live on the OS window alone — an in-window transform is a second presentation surface');
  }
});

test('motion eases in from rest rather than starting at cruise speed', () => {
  const { motor, pump, plan } = createMotor();
  motor.applyPlan(plan());

  assert.strictEqual(motor.velocity, 0, 'each leg starts from rest');
  pump(1);
  const first = motor.velocity;
  pump(4);
  const later = motor.velocity;

  assert.ok(first > 0 && first < 10, `first frame velocity ${first} should be a gentle start`);
  assert.ok(later > first, 'velocity should ramp up');
  assert.ok(later <= 40 + 1e-9, 'must not exceed cruise speed');
});

test('motion eases out and stops exactly on the planned distance, reporting once', () => {
  const { motor, sent, pumpUntil, plan } = createMotor();
  motor.applyPlan(plan({ legDistance: 200 }));

  const frames = pumpUntil(() => motor.reported);
  assert.ok(frames > 0, 'leg should complete');
  assert.strictEqual(sent.legComplete, 1, 'exactly one completion report');
  assert.strictEqual(sent.reachedBound, 0, 'a mid-screen leg is not an edge hit');
  assert.ok(motor.traveled <= 200 + 1e-9, `overshot the leg: ${motor.traveled}`);
  assert.ok(motor.traveled >= 200 - 1e-9, `stopped short: ${motor.traveled}`);
  assert.strictEqual(motor.appliedX, 700, 'the leg lands exactly on the planned target');
  assert.strictEqual(motor.isWalkingVisual, false, 'stride animation must stop with the pet');
});

test('reaching the screen edge reports a bound hit instead of a finished leg', () => {
  const { motor, sent, pumpUntil, plan } = createMotor();
  // Leg is longer than the room left, so the edge is hit first.
  motor.applyPlan(plan({ x: 1560, legDistance: 400, maxX: 1600 }));

  pumpUntil(() => motor.reported);
  assert.strictEqual(sent.reachedBound, 1);
  assert.strictEqual(sent.legComplete, 0);
  assert.ok(motor.x <= 1600 + 1e-9, `walked past the edge: ${motor.x}`);
  assert.strictEqual(motor.appliedX, 1600, 'the pet lands exactly on the screen edge');
});

test('walking left is symmetric and respects the left edge', () => {
  const { motor, sent, pumpUntil, plan } = createMotor();
  motor.applyPlan(plan({ x: 60, direction: -1, legDistance: 400, minX: 20 }));

  pumpUntil(() => motor.reported);
  assert.strictEqual(sent.reachedBound, 1);
  assert.ok(motor.x >= 20 - 1e-9, `walked past the left edge: ${motor.x}`);
  assert.strictEqual(motor.appliedX, 20);
  for (let i = 1; i < sent.moves.length; i++) {
    const delta = sent.moves[i].x - sent.moves[i - 1].x;
    assert.strictEqual(delta, -1, `leftward step ${i} moved ${delta}px`);
  }
});

test('freezing decelerates to a halt without reporting arrival', () => {
  const { motor, sent, pump, plan } = createMotor();
  motor.applyPlan(plan());
  pump(30);
  const xWhenFrozen = motor.x;

  motor.setFrozen(true);
  pump(120);

  assert.strictEqual(motor.velocity, 0, 'must come to a complete stop');
  assert.strictEqual(motor.reported, false, 'a freeze is not an arrival');
  assert.strictEqual(sent.legComplete, 0);
  assert.strictEqual(motor.isWalkingVisual, false, 'stride animation stops while frozen');
  const glide = motor.x - xWhenFrozen;
  assert.ok(glide > 0 && glide < 12, `braking glide of ${glide}px should be short but smooth`);
});

test('a frozen pet stays put and resumes the same leg when released', () => {
  const { motor, sent, pump, pumpUntil, plan } = createMotor();
  motor.applyPlan(plan());
  pump(30);
  motor.setFrozen(true);
  pump(120);

  const parkedAt = motor.x;
  pump(60);
  assert.strictEqual(motor.x, parkedAt, 'must not drift while frozen');

  motor.setFrozen(false);
  pumpUntil(() => motor.reported);
  assert.strictEqual(sent.legComplete, 1, 'the interrupted leg still finishes');
  assert.ok(motor.traveled >= 200 - 1.0, `resumed leg stopped short: ${motor.traveled}`);
});

test('a starved frame is clamped so the pet never teleports', () => {
  const { motor, pump, plan } = createMotor();
  motor.applyPlan(plan());
  pump(40); // reach cruise
  const before = motor.x;

  pump(1, 4000); // a 4 second stall (GC, sleep, occluded window)

  const jump = motor.x - before;
  assert.ok(jump <= 40 * 0.05 + 1e-9, `single frame advanced ${jump}px — dt clamp failed`);
});

test('a new plan supersedes the one in flight and re-anchors instantly', () => {
  const { motor, sent, pump, plan } = createMotor();
  motor.applyPlan(plan());
  pump(30);

  motor.applyPlan(plan({ epoch: 2, x: 25, direction: 1, legDistance: 100 }));
  assert.strictEqual(motor.x, 25);
  assert.strictEqual(motor.epoch, 2);
  assert.strictEqual(motor.velocity, 0, 'the new leg starts from rest');
  assert.strictEqual(motor.traveled, 0);
  assert.strictEqual(motor.reported, false);

  pump(10);
  assert.ok(sent.moves.every((m) => m.epoch === 1 || m.epoch === 2));
  assert.strictEqual(sent.moves[sent.moves.length - 1].epoch, 2, 'reports carry the live epoch');
});

test('a plan that lands on the target needs no movement at all', () => {
  const { motor, sent, pump, plan } = createMotor();
  motor.applyPlan(plan({ legDistance: 0 }));
  pump(5);

  assert.strictEqual(sent.legComplete, 1, 'a zero-length leg completes immediately');
  assert.strictEqual(sent.moves.length, 0, 'and moves nothing');
});

test('faster gaits still advance one pixel at a time at 60Hz', () => {
  const { motor, sent, pump, plan } = createMotor({ cruiseSpeed: 52 });
  motor.applyPlan(plan({ cruiseSpeed: 52, legDistance: 300 }));
  pump(300);

  for (let i = 1; i < sent.moves.length; i++) {
    const delta = sent.moves[i].x - sent.moves[i - 1].x;
    assert.strictEqual(delta, 1, `brisk step ${i} moved ${delta}px`);
  }
});

test('a 144Hz display gets the same 1px glide, not faster travel', () => {
  const slow = createMotor();
  slow.motor.applyPlan(slow.plan());
  slow.pumpUntil(() => slow.motor.reported, 4000, 1000 / 60);

  const fast = createMotor();
  fast.motor.applyPlan(fast.plan());
  fast.pumpUntil(() => fast.motor.reported, 8000, 1000 / 144);

  // Same distance covered, same number of window moves — only the frame count differs.
  assert.strictEqual(fast.motor.appliedX, slow.motor.appliedX);
  assert.strictEqual(fast.sent.moves.length, slow.sent.moves.length);
  assert.ok(Math.abs(fast.motor.traveled - slow.motor.traveled) < 0.5,
    'travel distance must be frame-rate independent');
});

console.log(`\n=== Test Results: ${passedTests}/${totalTests} Passed ===`);
if (passedTests === totalTests) {
  console.log('All roam motor tests passed successfully!\n');
} else {
  process.exit(1);
}
