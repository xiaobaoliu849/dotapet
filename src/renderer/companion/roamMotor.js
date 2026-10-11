/**
 * RoamMotor — vsync-locked integrator for the walk plan.
 *
 * Two things make the pet glide instead of ratchet:
 *
 * 1. The clock is requestAnimationFrame, not a main-process timer. rAF is driven
 *    by the compositor, so dt is a uniform frame interval. Node timers on Windows
 *    are quantised to the ~15.6ms system tick, which used to smear a 25ms/px step
 *    schedule across 15.6/31.2ms boundaries and then emit 2-4px catch-up bursts.
 *
 * 2. There is exactly one presentation surface: the OS window itself, moved in
 *    integer 1px steps. An earlier design split the position across the window
 *    (async SetWindowPos through DWM) plus a sub-pixel GPU transform inside it
 *    (vsync-locked compositor) — the two never land in the same present on a
 *    transparent window, so every pixel step carried a visible flicker. At
 *    cruise gait the 1px cadence locks to the refresh rate (e.g. 48px/s is one
 *    pixel every ~3 frames at 144Hz), which reads as steady motion.
 */
export class RoamMotor {
  constructor() {
    this.plan = null;
    this.epoch = 0;
    this.x = 0;
    this.velocity = 0;   // px/s, ramped toward plan.cruiseSpeed
    this.traveled = 0;
    this.frozen = false; // cursor resting on the pet, or window hidden
    this.rafId = null;
    this.lastTs = 0;
    this.appliedX = null;
    this.isWalkingVisual = false;
    this.reported = false;
  }

  /** A new plan supersedes everything in flight; each leg starts from rest. */
  applyPlan(plan) {
    if (!plan || typeof plan.epoch !== 'number') return;
    this.plan = plan;
    this.epoch = plan.epoch;
    this.x = plan.x;
    this.velocity = 0;
    this.traveled = 0;
    this.lastTs = 0;
    this.appliedX = Math.round(plan.x);
    this.reported = false;

    if (plan.moving) {
      this.schedule();
    } else {
      this.cancel();
      this.setWalkingVisual(false);
    }
  }

  setFrozen(frozen) {
    const next = Boolean(frozen);
    if (this.frozen === next) return;
    this.frozen = next;
    // Unfreezing resumes the same leg; the ramp accelerates it back up.
    if (!next && this.plan?.moving) this.schedule();
  }

  schedule() {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame((ts) => this.frame(ts));
  }

  cancel() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastTs = 0;
  }

  frame(ts) {
    this.rafId = null;
    const plan = this.plan;
    if (!plan || !plan.moving) {
      this.setWalkingVisual(false);
      return;
    }

    if (!this.lastTs) this.lastTs = ts;
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.05) dt = 0.05; // a starved frame must not teleport the pet

    const dir = plan.direction;
    const legLeft = Math.max(0, plan.legDistance - this.traveled);
    const edgeLeft = dir > 0
      ? Math.max(0, plan.maxX - this.x)
      : Math.max(0, this.x - plan.minX);
    const remaining = Math.min(legLeft, edgeLeft);

    // Ease in, cruise, then ease out so the stop lands exactly on the target.
    const brakingDistance = (this.velocity * this.velocity) / (2 * plan.decel);
    if (this.frozen) {
      this.velocity = Math.max(0, this.velocity - plan.decel * dt);
    } else if (remaining <= brakingDistance) {
      this.velocity = Math.max(4, this.velocity - plan.decel * dt);
    } else {
      this.velocity = Math.min(plan.cruiseSpeed, this.velocity + plan.accel * dt);
    }

    let step = this.velocity * dt;
    // When the whole remaining gap fits in one frame, take it whole: the leg
    // lands exactly on its target instead of stranding the pet a sub-pixel
    // step short, and that final step is never larger than one pixel.
    if (!this.frozen && remaining <= Math.max(step, 1)) step = remaining;

    this.x += step * dir;
    this.traveled += step;
    if (this.x > plan.maxX) this.x = plan.maxX;
    if (this.x < plan.minX) this.x = plan.minX;

    this.pushPosition();
    // Drive the stride from actual displacement with hysteresis: enter the
    // walk animation once the pet is clearly moving, leave it once it is
    // clearly stopped. A single threshold flaps on the ease-in/out ramps and
    // restarts the CSS animation dozens of times per leg.
    const moving = step > 0.02;
    this.setWalkingVisual(!this.frozen && (this.isWalkingVisual ? step > 0.005 : moving));

    if (this.frozen) {
      // Park once the deceleration finishes; setFrozen(false) restarts the loop.
      if (this.velocity > 0.01) this.schedule();
      else this.lastTs = 0;
      return;
    }

    if (remaining - step <= 1e-6) {
      this.reportArrival(edgeLeft - step <= 1.5);
      return;
    }
    this.schedule();
  }

  /**
   * Move the window to the nearest integer pixel, at most once per pixel.
   *
   * Nothing else carries the position — no sub-pixel transform inside the
   * window. Splitting the position across the OS window (async SetWindowPos)
   * and an in-window GPU transform (vsync-locked compositor) made the two
   * surfaces present in different frames on a transparent window, which read
   * as a constant flicker. One surface, integer steps, uniform rAF cadence:
   * there is nothing left that can shudder.
   */
  pushPosition() {
    const intX = Math.round(this.x);
    if (intX !== this.appliedX) {
      this.appliedX = intX;
      window.electronAPI?.roamApplyX?.(intX, this.epoch);
    }
  }

  setWalkingVisual(walking) {
    if (walking === this.isWalkingVisual) return;
    this.isWalkingVisual = walking;
    document.body.classList.toggle('is-roaming-walking', walking);
  }

  /** Hand control back to Main, which decides whether to turn or take a break. */
  reportArrival(hitEdge) {
    if (this.reported) return;
    this.reported = true;
    this.velocity = 0;
    this.setWalkingVisual(false);
    if (hitEdge) {
      window.electronAPI?.roamReachedBound?.(this.epoch);
    } else {
      window.electronAPI?.roamLegComplete?.(this.epoch);
    }
  }
}
