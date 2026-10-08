/**
 * PetPhysics - Physical Simulation (Gravity, Velocity, Squash & Stretch) for Desktop Pet
 */

export class PetPhysics {
  constructor(petElement, onLanded) {
    this.petEl = petElement;
    this.onLanded = onLanded;
    this.isAirborne = false;
    this.posY = 0;
    this.velocityY = 0;
    this.gravity = 0.85;
    this.groundY = 0;
    this.bounce = -0.35;
    this.animFrameId = null;
  }

  /**
   * Start falling with gravity from current height
   */
  startDrop(initialY = 0, groundY = 0) {
    this.posY = initialY;
    this.groundY = groundY;
    this.velocityY = 0;
    this.isAirborne = true;
    
    if (this.animFrameId && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.animFrameId);
    }
    this.step();
  }

  step() {
    if (!this.isAirborne) return;

    this.velocityY += this.gravity;
    this.posY += this.velocityY;

    if (this.posY >= this.groundY) {
      this.posY = this.groundY;
      if (Math.abs(this.velocityY) < 2) {
        // Came to rest
        this.isAirborne = false;
        this.applySquashAndStretch();
        if (this.onLanded) this.onLanded();
        return;
      } else {
        // Bounce
        this.velocityY *= this.bounce;
      }
    }

    if (this.petEl) {
      this.petEl.style.transform = `translateY(${this.posY.toFixed(2)}px)`;
    }

    if (typeof requestAnimationFrame !== 'undefined') {
      this.animFrameId = requestAnimationFrame(() => this.step());
    }
  }

  /**
   * Squash & stretch effect on landing impact
   */
  applySquashAndStretch() {
    if (!this.petEl) return;
    this.petEl.style.transition = 'transform 0.12s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    this.petEl.style.transform = 'translateY(0px) scale(1.15, 0.85)';
    
    setTimeout(() => {
      if (this.petEl) {
        this.petEl.style.transform = 'translateY(0px) scale(0.95, 1.05)';
        setTimeout(() => {
          if (this.petEl) {
            this.petEl.style.transform = 'translateY(0px) scale(1, 1)';
            this.petEl.style.transition = '';
          }
        }, 120);
      }
    }, 120);
  }

  cancel() {
    this.isAirborne = false;
    if (this.animFrameId && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
}
