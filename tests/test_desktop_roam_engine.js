import assert from 'assert';
import { DesktopRoamEngine } from '../src/main/roamEngine.js';

console.log('=== Starting DOTA 2 VoiceSpirit Companion Roam Engine Test Suite ===\n');

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

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };

// Cursor parked far from the pet so the hover watchdog never freezes it.
function makeScreen(cursor = { x: 0, y: 0 }) {
  return {
    getPrimaryDisplay: () => ({ workArea: WORK_AREA }),
    getDisplayNearestPoint: () => ({ workArea: WORK_AREA }),
    getCursorScreenPoint: () => cursor,
  };
}

function makeHarness(startPos = [500, 400]) {
  const events = [];
  const moves = [];
  // Track the live window position so setPosition() is visible to
  // getPosition() — real Windows moves the window, and the engine's
  // re-anchoring logic depends on reading it back.
  let pos = [...startPos];
  const win = {
    isDestroyed: () => false,
    getPosition: () => [...pos],
    getSize: () => [300, 440],
    setPosition: (x, y) => {
      pos[0] = x;
      pos[1] = y;
      moves.push([x, y]);
    },
    webContents: {
      send: (channel, data) => events.push({ channel, data }),
    },
  };
  return { win, events, moves };
}

function lastOn(events, channel) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].channel === channel) return events[i].data;
  }
  return null;
}

// Bounds the engine should derive: 20px margin, 300px wide window on a 1920 area.
const EXPECTED_MIN_X = 20;
const EXPECTED_MAX_X = 1920 - 300 - 20;

test('initializes idle with no timers and no motion authority', () => {
  const { win } = makeHarness();
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen() });

  assert.strictEqual(engine.isRoaming, false);
  assert.strictEqual(engine.isPaused, false);
  assert.strictEqual(engine.isTurning, false);
  assert.strictEqual(engine.isInteracting, false);
  assert.strictEqual(engine.direction, 1);
  assert.strictEqual(engine.epoch, 0);
  assert.strictEqual(engine.posX, null);
  assert.strictEqual(engine.idleTimer, null);
  assert.strictEqual(engine.turnTimer, null);
  assert.strictEqual(engine.hoverTimer, null);
});

test('start() emits a walk plan carrying gait, leg distance and screen bounds', () => {
  const { win, events } = makeHarness();
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen() });
  engine.start();

  const plan = lastOn(events, 'roam:plan');
  assert.ok(plan, 'expected a roam:plan event');
  assert.strictEqual(plan.moving, true);
  assert.strictEqual(plan.x, 500);
  assert.strictEqual(plan.direction, 1);
  assert.ok(plan.cruiseSpeed > 0, 'cruise speed must be positive');
  assert.ok(plan.accel > 0 && plan.decel > 0, 'ramps must be positive');
  assert.ok(plan.legDistance > 0, 'leg must have distance to cover');
  assert.strictEqual(plan.minX, EXPECTED_MIN_X);
  assert.strictEqual(plan.maxX, EXPECTED_MAX_X);
  assert.ok(['stroll', 'brisk', 'careful'].includes(engine.currentMood));

  const state = lastOn(events, 'roam:state-changed');
  assert.strictEqual(state.isRoaming, true);

  engine.stop();
});

test('stop() halts the motor, clears every timer and reports idle', () => {
  const { win, events } = makeHarness();
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen() });
  engine.start();
  engine.handleLegComplete(engine.epoch); // arm the idle timer
  assert.ok(engine.idleTimer !== null, 'idle timer should be armed');

  engine.stop();

  assert.strictEqual(engine.isRoaming, false);
  assert.strictEqual(engine.idleTimer, null);
  assert.strictEqual(engine.turnTimer, null);
  assert.strictEqual(engine.hoverTimer, null, 'hover watch must not outlive roaming');
  assert.strictEqual(lastOn(events, 'roam:plan').moving, false);
});

test('applyMotorX moves the window and preserves the cached Y', () => {
  const { win, moves } = makeHarness();
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen() });
  engine.start();

  engine.applyMotorX(612, engine.epoch);

  assert.deepStrictEqual(moves[moves.length - 1], [612, 400]);
  assert.strictEqual(engine.posX, 612);

  engine.stop();
});

test('applyMotorX clamps to the work area so the pet cannot leave the screen', () => {
  const { win, moves } = makeHarness();
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen() });
  engine.start();

  engine.applyMotorX(99999, engine.epoch);
  assert.strictEqual(moves[moves.length - 1][0], EXPECTED_MAX_X);

  engine.applyMotorX(-500, engine.epoch);
  assert.strictEqual(moves[moves.length - 1][0], EXPECTED_MIN_X);

  engine.stop();
});

test('stale-epoch reports are discarded so a superseded plan cannot fight the new one', () => {
  const { win, moves } = makeHarness();
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen() });
  engine.start();

  const staleEpoch = engine.epoch;
  engine.applyMotorX(700, staleEpoch);
  const movesBefore = moves.length;

  // A snap supersedes the in-flight plan; late frames from the old one must not land.
  engine.syncExternalPosition(25);
  engine.applyMotorX(701, staleEpoch);
  engine.handleLegComplete(staleEpoch);
  engine.handleReachedBound(staleEpoch);

  assert.strictEqual(moves.length, movesBefore, 'stale frame must not move the window');
  assert.strictEqual(engine.posX, 25, 'snapped position must survive stale reports');

  engine.stop();
});

test('handleLegComplete parks the pet and announces an idle breather', () => {
  const { win, events } = makeHarness();
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen() });
  engine.start();

  engine.handleLegComplete(engine.epoch);

  assert.strictEqual(engine.isPaused, true);
  assert.strictEqual(lastOn(events, 'roam:plan').moving, false);
  assert.ok(events.some((e) => e.channel === 'roam:idle-triggered'));

  engine.stop();
});

test('handleReachedBound turns around and holds still for the flip', () => {
  const { win, events } = makeHarness();
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen() });
  engine.start();
  const facing = engine.direction;

  engine.handleReachedBound(engine.epoch);

  assert.strictEqual(engine.isTurning, true);
  assert.strictEqual(engine.targetDirection, -facing);
  assert.strictEqual(lastOn(events, 'roam:plan').moving, false, 'must not walk mid-turn');
  assert.strictEqual(lastOn(events, 'roam:state-changed').isTurning, true);

  engine.stop();
});

test('a turn completes into a fresh leg walking the other way', (done) => {
  const { win, events } = makeHarness();
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen() });
  engine.start();
  const facing = engine.direction;
  engine.handleReachedBound(engine.epoch);

  // The turn timer is the only async hop in the engine; drive it deterministically.
  const timer = engine.turnTimer;
  assert.ok(timer, 'turn timer must be armed');
  clearTimeout(timer);
  engine.turnTimer = null;
  engine.direction = engine.targetDirection;
  engine.isTurning = false;
  engine.readWindowGeometry();
  engine.prepareNewLeg(engine.direction);

  assert.strictEqual(engine.direction, -facing);
  assert.strictEqual(engine.isTurning, false);
  const plan = lastOn(events, 'roam:plan');
  assert.strictEqual(plan.moving, true);
  assert.strictEqual(plan.direction, -facing);

  engine.stop();
});

test('a leg with no room ahead turns instead of grinding along the edge', () => {
  const { win, events } = makeHarness([EXPECTED_MAX_X - 5, 400]);
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen() });
  engine.direction = 1;
  engine.start();

  assert.strictEqual(engine.isTurning, true, 'should turn rather than plan a doomed leg');
  assert.strictEqual(engine.targetDirection, -1);
  assert.strictEqual(lastOn(events, 'roam:plan').moving, false);

  engine.stop();
});

test('syncExternalPosition adopts a snapped position and takes a breather', () => {
  const { win } = makeHarness();
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen() });
  engine.start();

  engine.syncExternalPosition(25);

  assert.strictEqual(engine.posX, 25);
  assert.strictEqual(engine.isPaused, true);

  engine.stop();
});

test('interaction pauses motion and resuming plans a new leg from the drop point', () => {
  const { win, events } = makeHarness();
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen() });
  engine.start();

  engine.pauseForInteraction();
  assert.strictEqual(engine.isInteracting, true);
  assert.strictEqual(lastOn(events, 'roam:plan').moving, false);
  assert.strictEqual(engine.idleTimer, null);
  assert.strictEqual(engine.turnTimer, null);

  engine.resumeAfterInteraction();
  assert.strictEqual(engine.isInteracting, false);
  assert.strictEqual(lastOn(events, 'roam:plan').moving, true);

  engine.stop();
});

test('REGRESSION: dragging the pet re-anchors the next leg to the drop point', () => {
  const { win, events } = makeHarness();
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen() });
  engine.start();

  engine.applyMotorX(700, engine.epoch);
  assert.strictEqual(engine.posX, 700);

  // User drags the window: Main's window:drag-move calls setPosition directly,
  // bypassing the engine. The next plan must start from where the pet was
  // dropped, not from the stale pre-drag anchor.
  win.setPosition(300, 250);
  engine.pauseForInteraction();
  engine.resumeAfterInteraction();

  const plan = lastOn(events, 'roam:plan');
  assert.strictEqual(plan.x, 300, 'next leg must start from the dragged position');
  assert.strictEqual(engine.posX, 300);

  engine.stop();
});

test('hover freeze is edge-triggered and pushed to the motor', () => {
  const { win, events } = makeHarness();
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen() });
  engine.start();

  engine.setHoverFrozen(true);
  assert.strictEqual(engine.isHoverFrozen, true);
  assert.strictEqual(lastOn(events, 'roam:freeze').frozen, true);
  assert.strictEqual(lastOn(events, 'roam:state-changed').isPaused, true);

  const countBefore = events.filter((e) => e.channel === 'roam:freeze').length;
  engine.setHoverFrozen(true); // repeat must not re-emit
  assert.strictEqual(events.filter((e) => e.channel === 'roam:freeze').length, countBefore);

  engine.setHoverFrozen(false);
  assert.strictEqual(lastOn(events, 'roam:freeze').frozen, false);

  engine.stop();
});

test('the hover watchdog freezes when the cursor rests on the pet', () => {
  const { win, events } = makeHarness();
  // Cursor sits inside the 300x440 window anchored at (500, 400).
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen({ x: 620, y: 560 }) });
  engine.start();

  assert.strictEqual(engine.isCursorOverWindow(), true);
  engine.setHoverFrozen(engine.isCursorOverWindow());
  assert.strictEqual(lastOn(events, 'roam:freeze').frozen, true);

  engine.stop();
});

test('refreshBounds recomputes the walkable range after a display change', () => {
  const { win, events } = makeHarness();
  const screen = makeScreen();
  const engine = new DesktopRoamEngine(() => win, { screen });
  engine.start();

  // Taskbar moves / resolution drops to 1280 wide.
  const narrow = { workArea: { x: 0, y: 0, width: 1280, height: 720 } };
  screen.getDisplayNearestPoint = () => narrow;
  screen.getPrimaryDisplay = () => narrow;
  engine.refreshBounds();

  assert.strictEqual(engine.bounds.maxX, 1280 - 300 - 20);
  assert.strictEqual(lastOn(events, 'roam:plan').maxX, 1280 - 300 - 20);

  engine.stop();
});

test('a pet stranded off-screen is pulled back into the new work area', () => {
  const { win } = makeHarness([1700, 400]);
  const screen = makeScreen();
  const engine = new DesktopRoamEngine(() => win, { screen });
  engine.start();

  const narrow = { workArea: { x: 0, y: 0, width: 1280, height: 720 } };
  screen.getDisplayNearestPoint = () => narrow;
  screen.getPrimaryDisplay = () => narrow;
  engine.refreshBounds();

  assert.ok(engine.posX <= 1280 - 300 - 20, 'pet must be clamped back on-screen');

  engine.stop();
});

test('survives a destroyed window without throwing', () => {
  let destroyed = false;
  const win = {
    isDestroyed: () => destroyed,
    getPosition: () => [500, 400],
    getSize: () => [300, 440],
    setPosition: () => {},
    webContents: { send: () => {} },
  };
  const engine = new DesktopRoamEngine(() => win, { screen: makeScreen() });
  engine.start();

  destroyed = true;
  engine.applyMotorX(600, engine.epoch);
  engine.handleLegComplete(engine.epoch);
  engine.refreshBounds();
  engine.stop();

  assert.strictEqual(engine.isRoaming, false);
});

console.log(`\n=== Test Results: ${passedTests}/${totalTests} Passed ===`);
if (passedTests === totalTests) {
  console.log('All roam engine tests passed successfully!\n');
} else {
  process.exit(1);
}
