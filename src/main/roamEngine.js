import electron from 'electron';

/**
 * Desktop Pet Roaming — Authority & Planner
 *
 * The main process owns *policy* (which way to walk, how far, when to pause,
 * when to turn) but deliberately owns no per-frame clock any more.
 *
 * Why: Node/libuv timers on Windows are quantised to the ~15.6ms system tick,
 * so the previous "one integer pixel every 25ms" loop could only fire steps on
 * 15.6/31.2/46.8ms boundaries and then emitted 2-4 pixels inside a single JS
 * turn to catch up. Visually that is a ratchet — exactly the jitter successive
 * accumulator rewrites kept chasing. Integer-pixel-only motion has a second
 * hard floor: at 40px/s a 1px hop lands every 25ms, which never divides evenly
 * into a 16.7ms refresh, so the steps beat against vsync.
 *
 * So integration moved to the renderer's RoamMotor, which runs on
 * requestAnimationFrame (vsync-locked, uniform dt, `backgroundThrottling` is
 * already disabled for this window) and renders the sub-pixel remainder as a
 * GPU transform inside the window. The renderer reports back only when the
 * integer window X actually changes, so this class does ~40 SetWindowPos calls
 * per second and zero polling syscalls — down from ~120 ticks/s that each did
 * getPosition + getSize + getCursorScreenPoint + getDisplayNearestPoint.
 */

// Gait presets. Speeds stay in px/s; the renderer ramps into and out of them.
const MOODS = [
  { id: 'stroll', weight: 0.55, speed: 40, minDist: 120, distSpread: 90 },
  { id: 'brisk', weight: 0.30, speed: 52, minDist: 150, distSpread: 110 },
  { id: 'careful', weight: 0.15, speed: 30, minDist: 75, distSpread: 50 },
];

const TURN_DURATION_MS = 320;

export class DesktopRoamEngine {
  constructor(getMainWindow, options = {}) {
    this.getMainWindow = getMainWindow;
    this.screenApi = options.screen || electron?.screen || null;

    // Lifecycle
    this.isRoaming = false;
    this.isPaused = false;      // between legs (idle breather)
    this.isTurning = false;     // stationary 3D flip
    this.isInteracting = false; // drag / menu
    this.isHoverFrozen = false; // cursor resting on the pet

    // Kinematics authority
    this.direction = 1;         // 1 right, -1 left
    this.targetDirection = 1;
    this.posX = null;           // authoritative float X (DIP), mirrors renderer
    this.posY = 0;              // cached; only changes via drag / snap / display change
    this.currentMood = 'stroll';
    this.cruiseSpeed = 40;
    this.legDistance = 0;

    // Motion ramps (renderer integrates against these)
    this.accelPxPerSec2 = 90;
    this.decelPxPerSec2 = 110;

    // Geometry (fallback defaults; start() re-reads the live window size)
    this.winWidth = 340;
    this.winHeight = 440;
    this.boundaryMarginPx = 20;
    this.bounds = { minX: 0, maxX: 1620 };

    // Plans are epoch-stamped so position reports from a superseded plan
    // (mid-snap, mid-drag) can be discarded instead of fighting the new one.
    this.epoch = 0;
    this.idleTimer = null;
    this.turnTimer = null;
    this.hoverTimer = null;
    this.hoverPollMs = 100;
    this.hoverFreezeMarginPx = 10;
  }

  // ---------------------------------------------------------------- lifecycle

  toggle(forceState = null) {
    const next = forceState !== null ? forceState : !this.isRoaming;
    if (next) {
      this.start();
    } else {
      this.stop();
    }
    return this.isRoaming;
  }

  start() {
    this.isRoaming = true;
    this.isInteracting = false;
    this.isHoverFrozen = false;
    this.readWindowGeometry();
    this.startHoverWatch();
    this.prepareNewLeg();
  }

  stop() {
    this.isRoaming = false;
    this.isPaused = false;
    this.isTurning = false;
    this.isHoverFrozen = false;
    this.clearTimers();
    this.stopHoverWatch();
    this.sendPlan({ moving: false });
    this.notifyState();
  }

  clearTimers() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  // ------------------------------------------------------------ hover freeze

  /**
   * Freeze the pet while the cursor rests on it, so its buttons stay reachable.
   *
   * This has to be cursor polling rather than DOM pointerenter/pointerleave in
   * the renderer: when the *window* walks under a motionless cursor Windows does
   * not reliably synthesise enter/leave events, so a DOM-driven version would
   * both miss freezes and risk latching frozen forever. 10Hz is invisible to the
   * user (the motor decelerates smoothly anyway) and costs one syscall per poll,
   * versus the 125Hz × 4 syscalls the old per-tick check did.
   */
  startHoverWatch() {
    this.stopHoverWatch();
    this.hoverTimer = setInterval(() => {
      if (!this.isRoaming) return;
      this.setHoverFrozen(this.isCursorOverWindow());
    }, this.hoverPollMs);
  }

  stopHoverWatch() {
    if (this.hoverTimer) {
      clearInterval(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  isCursorOverWindow() {
    try {
      const scr = this.getScreen();
      if (!scr?.getCursorScreenPoint) return false;
      const c = scr.getCursorScreenPoint();
      const m = this.hoverFreezeMarginPx;
      const wx = this.posX ?? 0;
      const wy = this.posY;
      return c.x >= wx - m && c.x <= wx + this.winWidth + m &&
             c.y >= wy - m && c.y <= wy + this.winHeight + m;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------- geometry

  getScreen() {
    if (this.screenApi) return this.screenApi;
    if (electron && typeof electron === 'object' && electron.screen) return electron.screen;
    return null;
  }

  /**
   * Refresh the cached Y and the walkable X range. Called once per plan (a few
   * times per minute) rather than per frame.
   *
   * The window's actual X is always adopted as the motion anchor: while roaming
   * it matches posX (applyMotorX moves both in lockstep), but external movers
   * (user drag, taskbar-driven repositions) bypass this class, so re-reading the
   * window here re-anchors the next leg to wherever the pet truly is.
   */
  readWindowGeometry() {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      try {
        const [curX, curY] = win.getPosition();
        this.posY = curY;
        this.posX = curX;
        const [ww, wh] = win.getSize();
        if (ww > 0) this.winWidth = ww;
        if (wh > 0) this.winHeight = wh;
      } catch (e) {
        // window vanished mid-call; keep the previous cache
      }
    }

    const scr = this.getScreen();
    if (scr) {
      const anchorX = Math.round(this.posX ?? 0);
      const display = scr.getDisplayNearestPoint?.({ x: anchorX, y: this.posY })
        || scr.getPrimaryDisplay?.();
      const workArea = display?.workArea;
      if (workArea) {
        const minX = workArea.x + this.boundaryMarginPx;
        const maxX = workArea.x + workArea.width - this.winWidth - this.boundaryMarginPx;
        this.bounds = { minX, maxX: Math.max(minX, maxX) };
      }
    }

    if (this.posX !== null) {
      this.posX = Math.min(this.bounds.maxX, Math.max(this.bounds.minX, this.posX));
    }
  }

  refreshBounds() {
    this.readWindowGeometry();
    if (this.isRoaming) this.sendPlan({ moving: this.isWalkable() });
  }

  isWalkable() {
    return this.isRoaming && !this.isPaused && !this.isTurning && !this.isInteracting;
  }

  // ------------------------------------------------------------------ legs

  pickMood() {
    const roll = Math.random();
    let acc = 0;
    for (const mood of MOODS) {
      acc += mood.weight;
      if (roll < acc) return mood;
    }
    return MOODS[0];
  }

  prepareNewLeg(forcedDirection = null) {
    if (forcedDirection !== null) this.direction = forcedDirection;
    this.targetDirection = this.direction;
    this.isPaused = false;
    this.isTurning = false;

    const mood = this.pickMood();
    this.currentMood = mood.id;
    this.cruiseSpeed = mood.speed;
    this.legDistance = mood.minDist + Math.floor(Math.random() * mood.distSpread);

    // Turn around instead of grinding along the edge when there is no room left.
    const room = this.direction > 0
      ? this.bounds.maxX - (this.posX ?? 0)
      : (this.posX ?? 0) - this.bounds.minX;
    if (room < 24) {
      this.triggerSmoothTurn(-this.direction);
      return;
    }

    this.sendPlan({ moving: true });
    this.notifyState();
  }

  triggerSmoothTurn(newDirection) {
    if (this.isTurning) return;
    this.isTurning = true;
    this.isPaused = false;
    this.targetDirection = newDirection;

    // Hold still for the flip animation, then walk off the other way.
    this.sendPlan({ moving: false });
    this.notifyState();

    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      if (!this.isRoaming || this.isInteracting) return;
      this.direction = this.targetDirection;
      this.isTurning = false;
      this.readWindowGeometry();
      this.prepareNewLeg(this.direction);
    }, TURN_DURATION_MS);
  }

  triggerIdlePause() {
    this.isPaused = true;
    this.isTurning = false;
    this.sendPlan({ moving: false });
    this.notifyState();

    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('roam:idle-triggered');
    }

    const pauseMs = 2800 + Math.random() * 3200;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.isRoaming || this.isInteracting) return;
      this.readWindowGeometry();
      const nextDir = Math.random() > 0.5 ? 1 : -1;
      if (nextDir !== this.direction) {
        this.triggerSmoothTurn(nextDir);
      } else {
        this.prepareNewLeg(nextDir);
      }
    }, pauseMs);
  }

  // ------------------------------------------------- renderer -> main reports

  /**
   * The motor reached the integer pixel `x`. This is the only place the window
   * is actually moved, so it runs at most once per pixel of travel.
   */
  applyMotorX(x, epoch) {
    if (!this.isRoaming || epoch !== this.epoch) return;
    if (!Number.isFinite(x)) return;

    const clamped = Math.min(this.bounds.maxX, Math.max(this.bounds.minX, Math.round(x)));
    this.posX = clamped;

    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) return;
    try {
      win.setPosition(clamped, this.posY);
    } catch (e) {
      // ignore transient failures (window closing)
    }
  }

  /** Motor consumed the whole leg and came to rest. */
  handleLegComplete(epoch) {
    if (!this.isRoaming || epoch !== this.epoch) return;
    if (this.isPaused || this.isTurning || this.isInteracting) return;
    this.triggerIdlePause();
  }

  /** Motor eased to a stop against the left/right edge of the work area. */
  handleReachedBound(epoch) {
    if (!this.isRoaming || epoch !== this.epoch) return;
    if (this.isTurning || this.isInteracting) return;
    this.triggerSmoothTurn(-this.direction);
  }

  /**
   * Cursor entered / left the pet. The motor eases to a halt on its own rather
   * than snapping, so this only flips a flag and keeps the sprite animation
   * honest (walk cycle -> idle breathing).
   */
  setHoverFrozen(frozen) {
    const next = Boolean(frozen);
    if (this.isHoverFrozen === next) return;
    this.isHoverFrozen = next;

    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('roam:freeze', { frozen: next, epoch: this.epoch });
    }
    this.notifyState();
  }

  // ------------------------------------------------------ external overrides

  pauseForInteraction() {
    this.isInteracting = true;
    this.clearTimers();
    this.sendPlan({ moving: false });
    this.notifyState();
  }

  resumeAfterInteraction() {
    this.isInteracting = false;
    this.readWindowGeometry();
    if (!this.isRoaming) return;
    // Re-anchor to wherever the pet was dropped and stroll on from there.
    this.prepareNewLeg();
  }

  /** Tray / popover snapped the window somewhere; adopt it and take a breather. */
  syncExternalPosition(newX) {
    this.clearTimers();
    this.readWindowGeometry();
    this.posX = Math.round(newX);
    if (this.isRoaming) this.triggerIdlePause();
  }

  // --------------------------------------------------------- main -> renderer

  sendPlan({ moving }) {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) return;

    this.epoch += 1;
    win.webContents.send('roam:plan', {
      epoch: this.epoch,
      moving: Boolean(moving) && this.isRoaming,
      x: this.posX ?? 0,
      direction: this.direction,
      cruiseSpeed: this.cruiseSpeed,
      accel: this.accelPxPerSec2,
      decel: this.decelPxPerSec2,
      legDistance: this.legDistance,
      minX: this.bounds.minX,
      maxX: this.bounds.maxX,
    });
  }

  notifyState() {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('roam:state-changed', {
      isRoaming: this.isRoaming,
      isPaused: this.isPaused || this.isHoverFrozen,
      isTurning: this.isTurning,
      direction: this.direction,
      state: this.isTurning ? 'TURNING' : (this.isWalkable() ? 'WALKING' : 'IDLE'),
      mood: this.currentMood,
    });
  }
}
