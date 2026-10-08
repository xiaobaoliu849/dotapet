/**
 * SnowEffect - High-Performance Particle FX & Interaction System for DOTA 2 Desktop Pets
 * Features auto-sleeping rendering loop (0% CPU/GPU overhead when idle).
 */

export class SnowEffectManager {
  constructor(container) {
    this.particles = [];
    this.isRunning = false;
    this.rafId = null;

    if (typeof document === 'undefined') {
      return;
    }

    this.container = container || document.body;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pet-fx-canvas';
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '999';

    if (this.container?.appendChild) {
      this.container.appendChild(this.canvas);
    }

    this.ctx = this.canvas.getContext?.('2d');
    this.resize();

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.resize(), { passive: true });
    }

    this.animate = this.animate.bind(this);
  }

  resize() {
    if (!this.canvas) return;
    this.canvas.width = this.container?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 300);
    this.canvas.height = this.container?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 440);
  }

  /**
   * Ensure particle render loop is active when new particles exist
   */
  ensureRunning() {
    if (this.isRunning || typeof requestAnimationFrame === 'undefined' || !this.ctx) return;
    this.isRunning = true;
    this.rafId = requestAnimationFrame(this.animate);
  }

  /**
   * Spawn frost/nature/gold footprint under pet paws
   */
  spawnPawPrint(x, y, color = '#bae6fd') {
    this.particles.push({
      type: 'paw',
      x,
      y,
      size: 4 + Math.random() * 2,
      color,
      alpha: 0.85,
      decay: 0.015,
    });
    this.ensureRunning();
  }

  /**
   * Spawn love hearts when pet is patted
   */
  spawnHearts(x, y) {
    for (let i = 0; i < 3; i++) {
      this.particles.push({
        type: 'heart',
        x: x + (Math.random() - 0.5) * 30,
        y: y + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 1.5,
        vy: -1.5 - Math.random() * 2,
        size: 10 + Math.random() * 6,
        alpha: 1.0,
        decay: 0.02,
        color: '#f43f5e',
      });
    }
    this.ensureRunning();
  }

  /**
   * Spawn healing green sparks (Tango / Salve)
   */
  spawnHealSparkles(x, y, color = '#4ade80') {
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2.5;
      this.particles.push({
        type: 'sparkle',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        size: 3 + Math.random() * 3,
        alpha: 1.0,
        decay: 0.025,
        color,
      });
    }
    this.ensureRunning();
  }

  /**
   * Spawn gold radiance sparks (Rapier / Gold coins)
   */
  spawnGoldSparkles(x, y, color = '#facc15') {
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3;
      this.particles.push({
        type: 'sparkle',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 4 + Math.random() * 3,
        alpha: 1.0,
        decay: 0.03,
        color,
      });
    }
    this.ensureRunning();
  }

  /**
   * Spawn snowball / water landing splash
   */
  spawnSnowSplash(x, y, color = '#e0f2fe') {
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3.5;
      this.particles.push({
        type: 'snow',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        size: 3 + Math.random() * 3,
        alpha: 1.0,
        decay: 0.035,
        color,
      });
    }
    this.ensureRunning();
  }

  animate() {
    if (!this.ctx) {
      this.isRunning = false;
      return;
    }

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.alpha -= p.decay;

      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, p.alpha);

      if (p.type === 'paw') {
        this.ctx.fillStyle = p.color;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        this.ctx.fill();
      } else if (p.type === 'heart') {
        p.x += p.vx;
        p.y += p.vy;
        this.ctx.fillStyle = p.color;
        this.drawHeart(p.x, p.y, p.size);
      } else if (p.type === 'sparkle' || p.type === 'snow') {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05; // light gravity
        this.ctx.fillStyle = p.color;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        this.ctx.fill();
      }

      this.ctx.restore();
    }

    // Auto-sleep loop when all particles have faded away
    if (this.particles.length > 0) {
      this.rafId = requestAnimationFrame(this.animate);
    } else {
      this.isRunning = false;
      this.rafId = null;
    }
  }

  drawHeart(x, y, size) {
    const ctx = this.ctx;
    ctx.beginPath();
    const topCurveHeight = size * 0.3;
    ctx.moveTo(x, y + topCurveHeight);
    ctx.bezierCurveTo(x, y, x - size / 2, y, x - size / 2, y + topCurveHeight);
    ctx.bezierCurveTo(x - size / 2, y + (size + topCurveHeight) / 2, x, y + (size + topCurveHeight) / 2, x, y + size);
    ctx.bezierCurveTo(x, y + (size + topCurveHeight) / 2, x + size / 2, y + (size + topCurveHeight) / 2, x + size / 2, y + topCurveHeight);
    ctx.bezierCurveTo(x + size / 2, y, x, y, x, y + topCurveHeight);
    ctx.closePath();
    ctx.fill();
  }

  destroy() {
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.particles = [];
    this.isRunning = false;
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}
