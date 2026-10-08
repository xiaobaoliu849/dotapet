/**
 * Live2DInterpolator - High-Precision Skeletal & Live2D-Style Fine-Grained Interpolator
 * Provides multi-layered bone deformation, harmonic breathing, 2nd-order damped harmonic
 * spring physics for secondary motion (ears/tail/wings/horns), mouse gaze tracking,
 * autonomous micro-saccades, squash-and-stretch landings, and state morphing.
 */

export class DampedSpring {
  constructor(stiffness = 160, damping = 16) {
    this.stiffness = stiffness;
    this.damping = damping;
    this.value = 0;
    this.target = 0;
    this.velocity = 0;
  }

  update(dt) {
    if (dt <= 0) return this.value;
    const clampedDt = Math.min(dt, 0.05); // Prevent frame spike explosion
    const force = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
    this.velocity += force * clampedDt;
    this.value += this.velocity * clampedDt;
    return this.value;
  }

  setTarget(t) {
    this.target = t;
  }

  impulse(v) {
    this.velocity += v;
  }

  reset(val = 0) {
    this.value = val;
    this.target = val;
    this.velocity = 0;
  }
}

export class Live2DInterpolator {
  constructor(options = {}) {
    this.targetElement = options.targetElement || null;
    this.containerElement = options.containerElement || null;

    // Live2D Standard Parameter State
    this.params = {
      ParamAngleX: 0,        // Head yaw (-30 to 30 deg)
      ParamAngleY: 0,        // Head pitch (-20 to 20 deg)
      ParamAngleZ: 0,        // Head roll (-15 to 15 deg)
      ParamBodyAngleX: 0,    // Body lean (-15 to 15 deg)
      ParamBreath: 0,        // Breath cycle (0.0 to 1.0)
      ParamEyeOpen: 1.0,     // Eye openness (0.0 to 1.0)
      ParamSpringEar: 0,     // Ear bounce angle
      ParamSpringTail: 0,    // Tail/wings swing angle
      ParamSquashX: 1.0,     // Width deformation
      ParamSquashY: 1.0,     // Height deformation
      ParamMorph: 1.0,       // Cross-fade opacity
    };

    // Internal Springs
    this.springGazeX = new DampedSpring(90, 14);
    this.springGazeY = new DampedSpring(90, 14);
    this.springEar = new DampedSpring(220, 15);
    this.springTail = new DampedSpring(140, 12);
    this.springSquashX = new DampedSpring(260, 18);
    this.springSquashY = new DampedSpring(260, 18);
    this.springSquashX.reset(1.0);
    this.springSquashY.reset(1.0);
    this.springSquashX.target = 1.0;
    this.springSquashY.target = 1.0;

    // Breathing parameters
    this.breathTime = 0;
    this.breathPeriod = options.breathPeriod || 3.2; // seconds per breath

    // Blink & Micro-saccade timers
    this.blinkTimer = 0;
    this.nextBlinkTime = 2.5 + Math.random() * 2.5;
    this.isBlinking = false;
    this.blinkDuration = 0.15;
    this.blinkProgress = 0;

    this.saccadeTimer = 0;
    this.nextSaccadeTime = 1.5 + Math.random() * 2.0;
    this.saccadeOffsetX = 0;
    this.saccadeOffsetY = 0;

    // Mouse Tracking state
    this.mouseScreenX = null;
    this.mouseScreenY = null;
    this.isMouseTracking = true;

    // Vsync rAF loop
    this.rafId = null;
    this.lastTime = 0;
    this.isActive = false;

    this.initMouseListeners();
  }

  /**
   * Pause or resume mouse gaze tracking (e.g. during dragging or roaming)
   * @param {boolean} paused
   */
  pauseMouseTracking(paused = true) {
    this.isMouseTracking = !paused;
    if (paused) {
      this.mouseScreenX = null;
      this.mouseScreenY = null;
      this.springGazeX.setTarget(0);
      this.springGazeY.setTarget(0);
    }
  }

  initMouseListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('mousemove', (e) => {
      if (!this.isMouseTracking) return;
      this.mouseScreenX = e.clientX;
      this.mouseScreenY = e.clientY;
    }, { passive: true });
  }

  start() {
    if (this.isActive || typeof requestAnimationFrame === 'undefined') return;
    this.isActive = true;
    this.lastTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.loop = (now) => {
      if (!this.isActive) return;
      const dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      this.update(dt);
      this.applyToDOM();
      if (typeof requestAnimationFrame !== 'undefined') {
        this.rafId = requestAnimationFrame(this.loop);
      }
    };
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop() {
    this.isActive = false;
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Main simulation tick
   * @param {number} dt Delta time in seconds
   */
  update(dt) {
    if (!dt || isNaN(dt) || dt <= 0) return;
    const clampedDt = Math.min(dt, 0.05);

    // 1. Harmonic Breathing (Harmonic sine wave with soft ease)
    this.breathTime += clampedDt;
    const breathPhase = (this.breathTime % this.breathPeriod) / this.breathPeriod;
    // Harmonic curve: (sin(2*pi*t - pi/2) + 1) / 2
    this.params.ParamBreath = (Math.sin(breathPhase * Math.PI * 2 - Math.PI / 2) + 1) / 2;

    // 2. Autonomous Eye Blinking
    this.blinkTimer += clampedDt;
    if (!this.isBlinking && this.blinkTimer >= this.nextBlinkTime) {
      this.isBlinking = true;
      this.blinkProgress = 0;
      this.blinkTimer = 0;
      this.nextBlinkTime = 2.0 + Math.random() * 3.5;
    }

    if (this.isBlinking) {
      this.blinkProgress += clampedDt / this.blinkDuration;
      if (this.blinkProgress >= 1.0) {
        this.isBlinking = false;
        this.params.ParamEyeOpen = 1.0;
      } else {
        // Quick close and reopen parabola: 1 - 4*(p - 0.5)^2
        const p = this.blinkProgress;
        this.params.ParamEyeOpen = Math.max(0, 1 - Math.sin(p * Math.PI));
      }
    } else {
      this.params.ParamEyeOpen = 1.0;
    }

    // 3. Micro-Saccades (Subtle organic eye shifts)
    this.saccadeTimer += clampedDt;
    if (this.saccadeTimer >= this.nextSaccadeTime) {
      this.saccadeTimer = 0;
      this.nextSaccadeTime = 1.8 + Math.random() * 2.5;
      this.saccadeOffsetX = (Math.random() - 0.5) * 3.0; // deg
      this.saccadeOffsetY = (Math.random() - 0.5) * 2.0; // deg
    }

    // 4. Mouse Gaze Tracking with Spring Interpolation
    let targetAngleX = this.saccadeOffsetX;
    let targetAngleY = this.saccadeOffsetY;

    if (this.targetElement && this.mouseScreenX !== null && this.mouseScreenY !== null) {
      try {
        const rect = this.targetElement.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = this.mouseScreenX - centerX;
        const dy = this.mouseScreenY - centerY;

        // Compute gaze angle clamped to natural ranges
        const maxDist = 300;
        const normX = Math.max(-1, Math.min(1, dx / maxDist));
        const normY = Math.max(-1, Math.min(1, dy / maxDist));

        targetAngleX += normX * 18; // Max 18 deg yaw
        targetAngleY += normY * 12; // Max 12 deg pitch
      } catch (e) {}
    }

    this.springGazeX.setTarget(targetAngleX);
    this.springGazeY.setTarget(targetAngleY);

    this.params.ParamAngleX = this.springGazeX.update(clampedDt);
    this.params.ParamAngleY = this.springGazeY.update(clampedDt);

    // 5. Secondary Springs (Ears & Tail/Wings)
    // Dynamic coupling: head movement drives secondary spring impulses
    const gazeVelX = this.springGazeX.velocity;
    this.springEar.setTarget(-this.params.ParamAngleX * 0.4);
    this.springTail.setTarget(this.params.ParamAngleX * 0.6 + (this.params.ParamBreath - 0.5) * 8);

    if (Math.abs(gazeVelX) > 20) {
      this.springEar.impulse(gazeVelX * 0.05);
    }

    this.params.ParamSpringEar = this.springEar.update(clampedDt);
    this.params.ParamSpringTail = this.springTail.update(clampedDt);

    // 6. Squash and Stretch Spring Update
    this.params.ParamSquashX = this.springSquashX.update(clampedDt);
    this.params.ParamSquashY = this.springSquashY.update(clampedDt);
  }

  /**
   * Trigger Squash & Stretch impact (e.g. landing, jumping, petting)
   * @param {number} intensity Squash factor (e.g. 0.2 means 1.2x width, 0.8x height)
   */
  triggerSquashImpact(intensity = 0.25) {
    this.springSquashX.impulse(intensity * 12);
    this.springSquashY.impulse(-intensity * 12);
    this.springEar.impulse(intensity * 60);
    this.springTail.impulse(intensity * 40);
  }

  /**
   * Trigger quick pet joy wiggles
   */
  triggerJoyWiggle() {
    this.springEar.impulse(45);
    this.springTail.impulse(70);
    this.triggerSquashImpact(0.18);
  }

  /**
   * Apply calculated parameters to DOM CSS Custom Properties & GPU Transform
   */
  applyToDOM() {
    const el = this.targetElement || (typeof document !== 'undefined' ? document.getElementById('pet-avatar') : null);
    if (!el || !el.style) return;

    const breathScale = 1.0 + this.params.ParamBreath * 0.035;
    const breathY = -this.params.ParamBreath * 3.5; // px

    const totalScaleX = breathScale * this.params.ParamSquashX;
    const totalScaleY = breathScale * this.params.ParamSquashY;

    const rotX = (-this.params.ParamAngleY * 0.6).toFixed(2);
    const rotY = (this.params.ParamAngleX * 0.8).toFixed(2);
    const rotZ = (this.params.ParamAngleX * 0.2).toFixed(2);
    const transY = breathY.toFixed(2);
    const scX = totalScaleX.toFixed(3);
    const scY = totalScaleY.toFixed(3);

    // Apply Live2D GPU-accelerated parameter matrix
    const transform = `translate3d(0,${transY}px,0) rotateX(${rotX}deg) rotateY(${rotY}deg) rotateZ(${rotZ}deg) scale(${scX},${scY})`;

    if (this._lastTransform !== transform) {
      this._lastTransform = transform;
      el.style.transform = transform;
    }

    // Set CSS variables for sub-elements or external overlays
    const root = this.containerElement || (typeof document !== 'undefined' ? document.documentElement : null);
    if (root?.style) {
      root.style.setProperty('--live2d-angle-x', `${this.params.ParamAngleX.toFixed(2)}deg`);
      root.style.setProperty('--live2d-angle-y', `${this.params.ParamAngleY.toFixed(2)}deg`);
      root.style.setProperty('--live2d-breath', this.params.ParamBreath.toFixed(3));
      root.style.setProperty('--live2d-eye-open', this.params.ParamEyeOpen.toFixed(3));
      root.style.setProperty('--live2d-spring-ear', `${this.params.ParamSpringEar.toFixed(2)}deg`);
      root.style.setProperty('--live2d-spring-tail', `${this.params.ParamSpringTail.toFixed(2)}deg`);
    }
  }
}
