/**
 * PetStateMachine - High Level State Controller for DOTA 2 Desktop Pet Matrix
 * Coordinates Codex manifests for 5 classic companions, Live2D/skeletal interpolation,
 * particle FX, gravity physics, food feeding, and special signature skills.
 */

import { CodexPetLoader } from './CodexPetLoader.js';
import { SnowEffectManager } from './SnowEffect.js';
import { PetPhysics } from './PetPhysics.js';
import { Live2DInterpolator } from './Live2DInterpolator.js';

export class PetStateMachine {
  constructor(options = {}) {
    const hasDoc = typeof document !== 'undefined';
    this.container = options.container || (hasDoc ? document.getElementById('companion-root') : null);
    this.avatarEl = options.avatarEl || (hasDoc ? document.getElementById('pet-avatar') : null);
    this.motionWrapEl = options.motionWrapEl || (hasDoc ? document.getElementById('pet-motion-wrap') : null);
    this.statusTextEl = options.statusTextEl || (hasDoc ? document.getElementById('status-text') : null);
    this.statusPillEl = options.statusPillEl || (hasDoc ? document.getElementById('pet-status-pill') : null);
    this.onQuote = options.onQuote || null;
    this.onPetChanged = options.onPetChanged || null;
    this.renderAvatar = options.renderAvatar || null;

    this.loader = new CodexPetLoader();
    this.fx = new SnowEffectManager(this.container);
    this.physics = new PetPhysics(this.motionWrapEl, () => this.onLanded());
    this.live2d = new Live2DInterpolator({
      targetElement: this.avatarEl,
      containerElement: this.container,
    });

    this.currentPetName = 'aurora_wolf';
    this.currentState = 'idle';
    this.isPetMode = false;
    this.isSleeping = false;
    this.isDragging = false;
    this.isFeeding = false;
    this.isFetching = false;
    this.isSpecial = false;

    this.idleTimer = null;
    this.sleepTimeoutMs = 180000; // 3 mins idle -> auto sleep
    this.pettingMoves = 0;
    this.pettingTimer = null;
    // Pending "auto-return to idle" timer. Every transient state schedules its
    // exit through this one handle so a superseding transition (new GSI event,
    // user action) reliably cancels the stale one instead of both firing.
    this.stateTimer = null;

    this.initEventListeners();
  }

  /**
   * Initialize and load all 5 Pet Packages in the Matrix
   */
  async init() {
    try {
      await this.loader.loadAllPetPackages('assets/pets');
      console.log('[PetStateMachine] DOTA 2 Pet Matrix packages initialized:', this.loader.getAllPets().map(p => p.name));
      // Start Live2D interpolation engine
      this.live2d.start();
    } catch (e) {
      console.warn('[PetStateMachine] Init pet matrix failed:', e);
    }
  }

  /**
   * Switch Active Pet in the Matrix
   * @param {string} petName 'aurora_wolf' | 'donkey_courier' | 'treant_sapling' | 'mischievous_greevil' | 'baby_roshan'
   */
  switchPet(petName) {
    const targetPet = this.loader.getPet(petName);
    if (!targetPet) {
      console.warn(`[PetStateMachine] Pet not found: ${petName}`);
      return false;
    }

    this.currentPetName = petName;
    this.applyPetTheme(targetPet);
    this.setState('idle', true);
    this.resetIdleTimer();

    // Trigger joy spring & squash
    this.live2d.triggerJoyWiggle();

    // Trigger greeting quote
    const idleAsset = this.loader.getPetStateAsset(petName, 'idle');
    if (idleAsset && idleAsset.quote && this.onQuote) {
      this.onQuote(idleAsset.quote, targetPet);
    }

    if (this.onPetChanged) {
      this.onPetChanged(targetPet);
    }

    return true;
  }

  /**
   * Get Current Pet Package definition
   */
  getCurrentPet() {
    return this.loader.getPet(this.currentPetName);
  }

  /**
   * Get All Available Pets in the Matrix
   */
  getAvailablePets() {
    return this.loader.getAllPets();
  }

  /**
   * Apply Theme Colors and CSS Custom Properties for Active Pet
   */
  applyPetTheme(pet) {
    if (!pet) return;
    if (typeof document !== 'undefined' && document.documentElement?.style) {
      const root = document.documentElement;
      root.style.setProperty('--pet-theme-color', pet.themeColor || '#38bdf8');
      root.style.setProperty('--pet-secondary-color', pet.secondaryColor || '#bae6fd');
    }

    if (this.statusPillEl?.style) {
      this.statusPillEl.style.borderColor = pet.themeColor || '#38bdf8';
    }
  }

  /**
   * Set active mode: true for Pet Mode, false for Classic Hero mode
   */
  setPetMode(enabled) {
    this.isPetMode = enabled;
    if (enabled) {
      this.live2d.start();
      const current = this.getCurrentPet();
      if (current) this.applyPetTheme(current);
      this.setState('idle', true);
      this.resetIdleTimer();
    } else {
      // Abandon every in-flight pet interaction so re-enabling the mode later
      // starts clean (a pending feed/special timer firing in hero mode is a
      // no-op, but its flag would latch forever).
      clearTimeout(this.stateTimer);
      this.stateTimer = null;
      this.isFeeding = false;
      this.isFetching = false;
      this.isSpecial = false;
      this.isSleeping = false;
      this.live2d.stop();
      if (this.avatarEl) {
        this.avatarEl.style.transform = '';
      }
    }
  }

  /**
   * Transition to a new state
   */
  setState(newState, force = false) {
    if (!this.isPetMode && !force) return;
    if (this.currentState === newState && !force) return;

    // A superseding state cancels any pending auto-return of the old one.
    clearTimeout(this.stateTimer);
    this.stateTimer = null;

    // Interrupt sleep on new active state
    if (this.isSleeping && newState !== 'sleep') {
      this.isSleeping = false;
    }

    this.currentState = newState;
    const asset = this.loader.getPetStateAsset(this.currentPetName, newState);
    if (!asset || !asset.src) return;

    if (this.avatarEl) {
      if (this.renderAvatar) this.renderAvatar(asset, this.currentPetName);
      else {
        this.avatarEl.src = asset.src;
        this.avatarEl.classList.add('is-svg-sprite');
      }
    }

    if (this.statusTextEl) {
      const stateLabels = {
        idle: '待命',
        walk: '漫步巡航',
        pet: '享受抚摸 ❤️',
        drag: '悬空扑腾',
        feed_tango: '啃吃树 (+115 HP)',
        feed_salve: '喝大药 (+400 HP)',
        feed_rapier: '叼圣剑 (+350 攻击)',
        fetch: '互动拾取 🎁',
        sleep: '梦乡中 Zzz...',
        think: '倾听思考 💭',
        speak: '欢快呼应 🎙️',
        special: asset.label || '专属绝招 ✨',
      };
      this.statusTextEl.textContent = stateLabels[newState] || asset.label || newState;
    }

    if (this.statusPillEl) {
      this.statusPillEl.className = `status-pill status-${newState}`;
    }

    // Trigger quote if available
    if (asset.quote && this.onQuote) {
      this.onQuote(asset.quote, this.getCurrentPet());
    }

    // Spawn FX
    this.triggerStateFX(newState);
  }

  /**
   * Trigger Particle FX based on state and active pet
   */
  triggerStateFX(state) {
    if (!this.avatarEl) return;
    const rect = this.avatarEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    if (state === 'pet') {
      this.fx.spawnHearts(centerX, centerY - 20);
      this.live2d.triggerJoyWiggle();
    } else if (state === 'feed_tango' || state === 'feed_salve') {
      this.fx.spawnHealSparkles(centerX, centerY);
      this.live2d.triggerSquashImpact(0.15);
    } else if (state === 'feed_rapier') {
      this.fx.spawnGoldSparkles(centerX, centerY);
      this.live2d.triggerJoyWiggle();
    } else if (state === 'fetch') {
      this.fx.spawnSnowSplash(centerX, centerY + 20);
    } else if (state === 'walk') {
      const pet = this.getCurrentPet();
      const footColor = pet?.secondaryColor || pet?.themeColor || '#bae6fd';
      this.fx.spawnPawPrint(centerX, centerY + 30, footColor);
    } else if (state === 'special') {
      this.triggerPetSpecialFX(centerX, centerY);
    }
  }

  /**
   * Custom Signature Particle Explosions for each pet
   */
  triggerPetSpecialFX(cx, cy) {
    const pet = this.currentPetName;
    if (pet === 'mischievous_greevil') {
      // Golden coins fountain
      for (let i = 0; i < 5; i++) {
        setTimeout(() => this.fx.spawnGoldSparkles(cx + (Math.random() - 0.5) * 60, cy + (Math.random() - 0.5) * 40), i * 120);
      }
    } else if (pet === 'treant_sapling') {
      // Blossom healing sparkles
      for (let i = 0; i < 5; i++) {
        setTimeout(() => this.fx.spawnHealSparkles(cx + (Math.random() - 0.5) * 60, cy + (Math.random() - 0.5) * 40), i * 120);
      }
    } else if (pet === 'baby_roshan') {
      // Magma explosion
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          this.fx.spawnGoldSparkles(cx + (Math.random() - 0.5) * 70, cy + (Math.random() - 0.5) * 40);
        }, i * 100);
      }
    } else if (pet === 'donkey_courier') {
      // Rocket speed gold trail
      for (let i = 0; i < 4; i++) {
        setTimeout(() => this.fx.spawnGoldSparkles(cx - 30 - i * 10, cy + 20), i * 150);
      }
    } else {
      // Aurora wolf blizzard splash
      for (let i = 0; i < 4; i++) {
        setTimeout(() => this.fx.spawnSnowSplash(cx + (Math.random() - 0.5) * 50, cy), i * 120);
      }
    }
    this.live2d.triggerJoyWiggle();
  }

  /**
   * Trigger Pet's Signature Special Ability
   */
  triggerSpecialSkill() {
    if (!this.isPetMode || this.isSpecial) return;
    this.isSpecial = true;
    const pet = this.getCurrentPet();
    const duration = pet?.specialSkill?.duration || 3000;

    this.setState('special', true);

    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.isSpecial = false;
      this.setState('idle', true);
      this.resetIdleTimer();
    }, duration);
  }

  /**
   * Feed DOTA 2 Item to pet
   */
  feedItem(itemType) {
    if (!this.isPetMode) return;
    this.isFeeding = true;
    const stateKey = `feed_${itemType}`;
    this.setState(stateKey);

    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.isFeeding = false;
      this.setState('idle');
      this.resetIdleTimer();
    }, 2800);
  }

  /**
   * Throw Interactive Snowball/Fetch Item
   */
  throwSnowball() {
    if (!this.isPetMode || this.isFetching) return;
    this.isFetching = true;
    this.setState('fetch');

    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.setState('pet');
      this.stateTimer = setTimeout(() => {
        this.stateTimer = null;
        this.isFetching = false;
        this.setState('idle');
        this.resetIdleTimer();
      }, 1500);
    }, 2000);
  }

  /**
   * DOTA 2 GSI Combat Reactions with Pet Personalities
   */
  onRampage() {
    this.setState('feed_rapier', true);
    this.triggerPetSpecialFX(100, 100);
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.setState('special', true);
      this.stateTimer = setTimeout(() => {
        this.stateTimer = null;
        this.setState('idle', true);
        this.resetIdleTimer();
      }, 2500);
    }, 2000);
  }

  onKillStreak(streakType = 'single') {
    if (streakType === 'rampage' || streakType === 'ultra') {
      this.onRampage();
      return;
    }
    this.setState('pet', true);
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.setState('idle', true);
      this.resetIdleTimer();
    }, 2000);
  }

  onHeroDeath() {
    this.setState('sleep', true);
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.setState('idle', true);
      this.resetIdleTimer();
    }, 4000);
  }

  onLowHealthAlert() {
    this.setState('drag', true);
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.setState('idle', true);
      this.resetIdleTimer();
    }, 1800);
  }

  /**
   * Petting detection on mouse movement over pet head
   */
  onPetHeadHover() {
    if (!this.isPetMode || this.isDragging || this.isFeeding || this.isFetching || this.isSpecial) return;

    this.pettingMoves++;
    if (this.pettingMoves > 3) {
      this.setState('pet');
      clearTimeout(this.pettingTimer);
      this.pettingTimer = setTimeout(() => {
        this.pettingMoves = 0;
        this.setState('idle');
        this.resetIdleTimer();
      }, 2000);
    }
  }

  /**
   * Drag started (Picked up in air)
   */
  onDragStart() {
    if (!this.isPetMode) return;
    this.isDragging = true;
    this.physics.cancel();
    this.live2d?.pauseMouseTracking(true);
    this.setState('drag');
    this.live2d?.triggerSquashImpact(-0.15); // Stretch on pick up
  }

  /**
   * Drag ended (Released from air with gravity drop)
   */
  onDragEnd(heightAboveGround = -30) {
    if (!this.isPetMode) return;
    this.isDragging = false;
    this.physics.startDrop(heightAboveGround, 0);
  }

  onLanded() {
    if (this.isPetMode && !this.isDragging) {
      this.live2d?.pauseMouseTracking(false);
      this.live2d?.triggerSquashImpact(0.3); // Squash on landing
      this.setState('idle');
      this.resetIdleTimer();
    }
  }

  resetIdleTimer() {
    clearTimeout(this.idleTimer);
    if (!this.isPetMode) return;

    this.idleTimer = setTimeout(() => {
      this.isSleeping = true;
      this.setState('sleep');
    }, this.sleepTimeoutMs);
  }

  initEventListeners() {
    if (!this.avatarEl) return;

    this.avatarEl.addEventListener('mousemove', () => {
      this.onPetHeadHover();
    });

    this.avatarEl.addEventListener('click', () => {
      if (this.isSleeping) {
        this.isSleeping = false;
        this.setState('idle');
        this.resetIdleTimer();
      }
    });
  }
}
