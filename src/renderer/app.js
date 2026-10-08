import { PetStateMachine } from './petEngine/PetStateMachine.js';
import { extractPetCatchphrases } from '../services/petPersona.js';
import { normalizeProfile, resolveAppearance, applyImageAppearance, applyBackground } from '../services/appearance.js';

let customizationData = null;

// Application State
const state = {
  currentHero: null,
  heroesConfig: null,
  appState: 'idle', // 'idle' | 'listening' | 'thinking' | 'speaking'
  isMicActive: false,
  isMicStarting: false,
  microphoneGeneration: 0,
  // Cloud voice session liveness, mirroring the engine's own status events.
  // The mic is gated on it: with no provider selected the audio would go
  // nowhere, so the toggle explains itself instead of eating silence.
  voiceConnected: false,
  isDragging: false,
  isPetMode: false,
  audioContext: null,
  mediaStream: null,
  scriptProcessor: null,
  analyser: null,
  activeSpeechText: '',
  isWindowPinned: false, // position locked: no dragging, no roaming
  scaleMode: 'normal', // 'normal' | 'compact' | 'mini'
  // UI filter state
  searchQuery: '',
  selectedAttrFilter: 'all',
  selectedComplexityFilter: 'all',
  selectedAttackFilter: 'all',
  selectedDetailHero: null,
  activeModalTab: 'heroes', // 'heroes' | 'detail' | 'wardrobe'
};

/**
 * Streaming Audio Player for real-time AI speech output (PCM 24kHz)
 */
class StreamAudioPlayer {
  constructor() {
    this.audioCtx = null;
    this.nextStartTime = 0;
    this.sampleRate = 24000;
    this.activeSources = [];
    this.masterGain = null;
  }

  ensureContext() {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass({ sampleRate: this.sampleRate });
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.value = 1;
      this.masterGain.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  isPlaying() {
    return this.activeSources.length > 0 || (this.audioCtx && this.nextStartTime > this.audioCtx.currentTime);
  }

  playPcmChunk(pcmData, sampleRate = 24000) {
    try {
      this.sampleRate = sampleRate;
      this.ensureContext();

      let int16Array;
      if (pcmData instanceof ArrayBuffer) {
        int16Array = new Int16Array(pcmData);
      } else if (pcmData?.buffer && pcmData.buffer instanceof ArrayBuffer) {
        int16Array = new Int16Array(pcmData.buffer, pcmData.byteOffset || 0, (pcmData.byteLength || pcmData.length) / 2);
      } else if (typeof pcmData === 'string') {
        const binary = atob(pcmData);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        int16Array = new Int16Array(bytes.buffer);
      }

      if (!int16Array || int16Array.length === 0) return;

      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768;
      }

      const audioBuffer = this.audioCtx.createBuffer(1, float32Array.length, this.sampleRate);
      audioBuffer.copyToChannel(float32Array, 0);

      const source = this.audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.masterGain || this.audioCtx.destination);

      const currentTime = this.audioCtx.currentTime;
      // Seamless jitter cushion: if buffer underran or starting fresh, add 60ms head start (VoiceSpirit pattern)
      if (this.nextStartTime < currentTime) {
        this.nextStartTime = currentTime + 0.06;
      }

      const startAt = Math.max(currentTime + 0.02, this.nextStartTime);
      source.start(startAt);
      this.nextStartTime = startAt + audioBuffer.duration;
      this.activeSources.push(source);
      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx !== -1) this.activeSources.splice(idx, 1);
      };
    } catch (e) {
      console.warn('[StreamAudioPlayer] Play chunk error:', e);
    }
  }

  reset() {
    this.nextStartTime = 0;
    // Anti-click: smooth linear ramp-down on barge-in interruption before stopping sources
    if (this.masterGain && this.audioCtx && this.audioCtx.state === 'running') {
      try {
        const now = this.audioCtx.currentTime;
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
        this.masterGain.gain.linearRampToValueAtTime(0, now + 0.02);
      } catch (e) {}
    }
    const sourcesToStop = [...this.activeSources];
    this.activeSources = [];
    setTimeout(() => {
      for (const src of sourcesToStop) {
        try {
          src.stop();
          src.disconnect();
        } catch (e) {}
      }
      if (this.masterGain && this.audioCtx) {
        try {
          this.masterGain.gain.setValueAtTime(1, this.audioCtx.currentTime);
        } catch (e) {}
      }
    }, 25);
  }
}
const audioPlayer = new StreamAudioPlayer();

// Desktop Pet Roaming / Autonomous Wandering State
// The Main process plans the walk (direction, distance, gait, pauses); this
// mirrors that state for the UI, while RoamMotor below integrates the motion.
const roamState = {
  isRoaming: false,
  isPaused: false,
  isTurning: false,
  direction: 1, // 1 for right, -1 for left
  speed: 0,
  targetSpeed: 42,
  mood: 'stroll',
};

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
class RoamMotor {
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

const roamMotor = new RoamMotor();

/**
 * Setup Fluid Window Dragging & Disable Unwanted Zoom Scaling
 */
function setupWindowDragging() {
  let dragTarget = null;
  let dragPointerId = null;
  let dragStartScreenX = 0;
  let dragStartScreenY = 0;

  // The window follows the cursor 1:1 during a drag, so on release the pointer
  // is still over the element the gesture started on and the browser fires a
  // full click there — dropping a drag on the hero/GSI badge used to open the
  // gallery. A real drag (movement beyond click jitter) must swallow exactly
  // that one click; plain clicks still go through.
  const DRAG_CLICK_SUPPRESS_PX = 5;
  let clickSuppressor = null;
  let clickSuppressorTimer = null;

  const clearClickSuppressor = () => {
    if (clickSuppressor) {
      window.removeEventListener('click', clickSuppressor, true);
      window.removeEventListener('mouseup', clickSuppressor, true);
      clickSuppressor = null;
    }
    if (clickSuppressorTimer) {
      clearTimeout(clickSuppressorTimer);
      clickSuppressorTimer = null;
    }
  };

  const suppressNextClick = () => {
    clearClickSuppressor();
    clickSuppressor = (e) => {
      e.stopPropagation();
      e.preventDefault();
      clearClickSuppressor();
    };
    window.addEventListener('click', clickSuppressor, true);
    window.addEventListener('mouseup', clickSuppressor, true);
    // If no click ever follows (pointercancel, focus loss), expire so a later
    // intentional click is not eaten.
    clickSuppressorTimer = setTimeout(clearClickSuppressor, 700);
  };

  // Prevent any browser zoom shortcuts (Ctrl + Wheel, Ctrl + +/-, Ctrl + 0)
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
    }
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
      e.preventDefault();
    }
  });

  const isInteractiveTarget = (target) => {
    if (!target) return false;
    return Boolean(
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('textarea') ||
      target.closest('.hero-tag-badge') ||
      target.closest('.gsi-badge') ||
      target.closest('.modal-card') ||
      target.closest('.chip-btn') ||
      target.closest('.tiny-btn') ||
      target.closest('.snap-popover') ||
      target.closest('.pet-matrix-popover') ||
      target.closest('.pet-context-menu') ||
      target.closest('.search-filter-box') ||
      target.closest('.skins-list') ||
      target.closest('.custom-skin-importer') ||
      target.closest('.hero-card') ||
      target.closest('.skin-item-card') ||
      target.closest('.catchphrase-item') ||
      target.closest('.ability-card') ||
      target.closest('.transcript-panel')
    );
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return; // Left click only for dragging
    if (isInteractiveTarget(e.target)) return;
    // A pinned companion is anchored — don't even play the drag animation or
    // arm the click suppressor; plain clicks keep working untouched.
    if (state.isWindowPinned) return;

    // A stale suppressor must never eat the click of a brand-new gesture.
    clearClickSuppressor();

    // Auto-dismiss open popovers and context menus so they don't block pet vision or receive clicks during drag
    closePetMatrixPopover();
    closePetContextMenu();
    closeSnapPopover();

    dragStartScreenX = e.screenX;
    dragStartScreenY = e.screenY;

    // Pause roaming if user starts dragging
    if (roamState.isRoaming) {
      pauseRoamForInteraction();
    }

    state.isDragging = true;
    document.body.classList.add('is-dragging-active');

    // Force Electron to capture all mouse events directly without click-through forwarding
    window.electronAPI?.setIgnoreMouseEvents(false);

    dragTarget = e.target;
    dragPointerId = e.pointerId;
    try {
      if (dragTarget && dragTarget.setPointerCapture) {
        dragTarget.setPointerCapture(dragPointerId);
      }
    } catch (err) {}

    if (state.isPetMode) {
      petStateMachine.onDragStart();
    } else {
      setPetSprite('action');
    }

    if (window.electronAPI?.startDrag) {
      window.electronAPI.startDrag(e.screenX, e.screenY);
    }
  };

  const onPointerMove = (e) => {
    if (!state.isDragging || !window.electronAPI?.moveDrag) return;

    // Send the freshest pointer position immediately — no rAF throttle. The
    // compositor presents at vsync regardless; queuing the IPC behind rAF only
    // added up to a full frame of cursor lag. Coalesced events carry every
    // sub-frame position the OS reported, so the last one is the newest.
    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const latest = coalesced && coalesced.length ? coalesced[coalesced.length - 1] : e;
    window.electronAPI.moveDrag(latest.screenX, latest.screenY);
  };

  const onPointerUp = (e) => {
    if (state.isDragging) {
      const movedPx = Math.hypot(e.screenX - dragStartScreenX, e.screenY - dragStartScreenY);
      if (movedPx > DRAG_CLICK_SUPPRESS_PX) {
        suppressNextClick();
      }

      state.isDragging = false;
      document.body.classList.remove('is-dragging-active');

      if (state.isPetMode) {
        petStateMachine.onDragEnd();
      } else {
        setPetSprite(state.appState === 'speaking' ? 'speaking' : 'idle');
      }

      try {
        if (dragTarget && dragTarget.releasePointerCapture && dragPointerId !== null) {
          dragTarget.releasePointerCapture(dragPointerId);
        }
      } catch (err) {}
      dragTarget = null;
      dragPointerId = null;

      if (window.electronAPI?.endDrag) {
        window.electronAPI.endDrag();
      }
    }
  };

  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('pointercancel', onPointerUp, { passive: true });
  window.addEventListener('lostpointercapture', onPointerUp, { passive: true });
}

/**
 * Toggle Desktop Pet Autonomous Roaming / Wandering Mode
 */
function toggleRoam() {
  if (state.isWindowPinned) {
    showToast('📌 位置已固定，点击 🔓 解锁后再漫游');
    return;
  }
  if (window.electronAPI?.toggleRoam) {
    window.electronAPI.toggleRoam();
  }
}

/**
 * Reflect the main process's pin (position lock) state in the top-bar button and context menu.
 */
function applyWindowPinState(pinned, showToastMsg = false) {
  const previous = state.isWindowPinned;
  state.isWindowPinned = Boolean(pinned);
  if (elements.btnPin) {
    elements.btnPin.classList.toggle('active', state.isWindowPinned);
    elements.btnPin.textContent = state.isWindowPinned ? '🔒' : '📌';
    elements.btnPin.title = state.isWindowPinned
      ? '已固定位置 (Alt+L)：不可拖拽/漫游，始终置顶 (点击解锁)'
      : '固定位置 (Alt+L)：锁定后不可拖拽/漫游，始终置顶';
  }
  if (elements.ctxBtnPin) {
    elements.ctxBtnPin.innerHTML = state.isWindowPinned
      ? '<span class="ctx-icon">🔓</span> 解锁位置 <span class="ctx-shortcut">Alt+L</span>'
      : '<span class="ctx-icon">📌</span> 固定位置 <span class="ctx-shortcut">Alt+L</span>';
  }
  if (showToastMsg && previous !== state.isWindowPinned) {
    showToast(state.isWindowPinned ? '📌 桌宠位置已锁定（防误触，始终置顶）' : '🔓 桌宠位置已解锁');
  }
}

/**
 * Apply companion scaling (100% normal / 75% compact / 55% mini).
 */
function applyScaleMode(scaleMode, label = '', showToastMsg = false) {
  state.scaleMode = scaleMode || 'normal';
  document.body.classList.remove('scale-compact', 'scale-mini');
  if (state.scaleMode === 'compact') {
    document.body.classList.add('scale-compact');
  } else if (state.scaleMode === 'mini') {
    document.body.classList.add('scale-mini');
  }

  if (elements.btnScale) {
    elements.btnScale.classList.toggle('active-compact', state.scaleMode === 'compact');
    elements.btnScale.classList.toggle('active-mini', state.scaleMode === 'mini');
    const scalePercent = state.scaleMode === 'mini' ? '55%' : (state.scaleMode === 'compact' ? '75%' : '100%');
    elements.btnScale.title = `伴侣缩放 (Alt+C): 当前 ${scalePercent} (点击切换 100%/75%/55%)`;
  }

  if (elements.ctxScaleLabel) {
    elements.ctxScaleLabel.textContent = state.scaleMode === 'mini' ? '55%' : (state.scaleMode === 'compact' ? '75%' : '100%');
  }

  if (showToastMsg) {
    const text = label || (state.scaleMode === 'mini' ? '极简迷你 (55%)' : (state.scaleMode === 'compact' ? '精简缩小 (75%)' : '标准尺寸 (100%)'));
    showToast(`📐 桌宠已切换: ${text}`);
  }
}

function updateRoamUIState(data) {
  if (!data) return;
  const { isRoaming, isPaused, isTurning, direction, mood } = data;
  roamState.isRoaming = Boolean(isRoaming);
  roamState.isPaused = Boolean(isPaused);
  roamState.isTurning = Boolean(isTurning);
  roamState.direction = direction || 1;
  roamState.mood = mood || 'stroll';

  if (elements.btnRoam) {
    elements.btnRoam.classList.toggle('active-glow', isRoaming);
    elements.btnRoam.title = isRoaming ? '停止桌宠漫游 (Alt+M)' : '开启桌宠漫游 (Alt+M)';
  }
  if (elements.ctxBtnRoam) {
    elements.ctxBtnRoam.innerHTML = isRoaming
      ? '<span class="ctx-icon">⏸️</span> 停止漫游巡航 (Alt+M)'
      : '<span class="ctx-icon">🐾</span> 开启漫游巡航 (Alt+M)';
  }

  // Set walk stride cadence per mood without mid-step jitter
  const moodPeriods = {
    brisk: '0.30s',
    stroll: '0.36s',
    careful: '0.44s',
  };
  document.documentElement.style.setProperty('--walk-period', moodPeriods[roamState.mood] || '0.36s');

  const isActuallyWalking = isRoaming && !isPaused && !isTurning;

  document.body.classList.toggle('is-roaming', isRoaming);
  document.body.classList.toggle('is-roam-idle', isRoaming && isPaused);
  document.body.classList.toggle('is-facing-left', direction < 0);
  document.body.classList.toggle('is-turning', Boolean(isTurning));
  // `is-roaming-walking` is owned by RoamMotor: it follows real velocity, so the
  // stride starts and stops with the actual ease-in/ease-out ramp.
  if (!isActuallyWalking) {
    roamMotor.setWalkingVisual(false);
  }
}

function handleRoamIdleTrigger() {
  const rand = Math.random();
  if (rand < 0.35) {
    // Joy hop micro-expression
    if (elements.petContainer) {
      elements.petContainer.classList.add('pet-joy-hop');
      setTimeout(() => {
        elements.petContainer?.classList.remove('pet-joy-hop');
      }, 600);
    }
    return;
  }
  if (rand < 0.65) {
    // Curious look around
    if (elements.petContainer) {
      elements.petContainer.classList.add('pet-look-around');
      setTimeout(() => {
        elements.petContainer?.classList.remove('pet-look-around');
      }, 850);
    }
    return;
  }

  // Companion voiceline / quote bubble — whoever is on stage speaks in pet
  // mode too; a hero name bubbling up under the courier is the same bug class
  // as the voice persona drift.
  if (state.isPetMode) {
    const assetName = Math.random() < 0.5 ? 'speak' : 'idle';
    const quote = petStateMachine.loader.getPetStateAsset(petStateMachine.currentPetName, assetName)?.quote
      || '嗷呜~ 召唤师，我在哦！';
    displayPetBubbleQuote(quote, petStateMachine.getCurrentPet());
    return;
  }

  if (!state.currentHero) return;
  const quotes = state.currentHero.catchphrases || [];
  if (quotes.length > 0) {
    const q = quotes[Math.floor(Math.random() * quotes.length)];
    displayTranslationHUD({
      original: `${state.currentHero.nameZh} · 漫游巡逻`,
      meaningZh: q,
      intent: 'strategy',
      suggestions: ['push mid', 'b b b', 'well played'],
      autoDismissMs: 3200,
    });
  }
}

function pauseRoamForInteraction() {
  // Handled synchronously in Main process during window:drag-start
}

/**
 * Snap Position Popover & Handlers
 */
function toggleSnapPopover(e) {
  e?.stopPropagation();
  closePetContextMenu();
  if (elements.snapPopover) {
    elements.snapPopover.classList.toggle('hidden');
  }
}

function closeSnapPopover() {
  if (elements.snapPopover && !elements.snapPopover.classList.contains('hidden')) {
    elements.snapPopover.classList.add('hidden');
  }
}

function snapToPosition(position) {
  closeSnapPopover();
  closePetContextMenu();
  pauseRoamForInteraction();
  if (window.electronAPI?.snapWindowTo) {
    window.electronAPI.snapWindowTo(position);
    const labels = {
      'bottom-right': '右下角',
      'bottom-left': '左下角',
      'center': '屏幕中央',
      'top-right': '右上角',
      'top-left': '左上角',
    };
    showToast(`📍 已吸附至 ${labels[position] || position}`);
  }
}

/**
 * Pet Double Click Interaction & Context Menu
 */
function handlePetDoubleClick() {
  pauseRoamForInteraction();
  if (state.isPetMode) {
    // The courier is on stage: greet with ITS voice, never the hero's. Skip
    // while a transient state owns the auto-return timer — stealing it would
    // latch isFeeding/isSpecial and disable petting until the next toggle.
    const sm = petStateMachine;
    const busy = sm.isSpecial || sm.isFeeding || sm.isFetching || sm.isSleeping
      || !['idle', 'walk'].includes(sm.currentState);
    if (!busy) {
      sm.setState('speak', true);
      setTimeout(() => {
        if (state.isPetMode && state.appState === 'idle') {
          sm.setState('idle', true);
        }
      }, 1600);
    }
    return;
  }
  if (!state.currentHero) return;

  elements.petContainer.classList.add('pet-pop-anim');
  setPetSprite('action');
  setTimeout(() => {
    elements.petContainer.classList.remove('pet-pop-anim');
    setPetSprite('idle');
  }, 500);

  const quotes = state.currentHero.catchphrases || [];
  const quote = quotes[Math.floor(Math.random() * quotes.length)] || `${state.currentHero.nameZh}: 召唤师，准备好战斗了吗？`;

  displayTranslationHUD({
    original: `${state.currentHero.nameZh} · 语音互动`,
    meaningZh: quote,
    isGreeting: true,
    autoDismissMs: 3500,
  });
}

function openPetContextMenu(e) {
  e.preventDefault();
  e.stopPropagation();

  if (state.isPetMode) {
    const pet = petStateMachine.getCurrentPet();
    elements.ctxHeroName.textContent = pet?.displayName || 'DOTA 2 萌宠';
    elements.ctxAttrBadge.textContent = '萌宠';
  } else if (state.currentHero) {
    elements.ctxHeroName.textContent = state.currentHero.nameZh || state.currentHero.nameEn;
    const attrNames = { str: '力量', agi: '敏捷', int: '智力', all: '全能' };
    elements.ctxAttrBadge.textContent = attrNames[state.currentHero.attribute] || '英雄';
  }

  elements.petContextMenu.classList.remove('hidden');
  closeSnapPopover();
}

function closePetContextMenu() {
  if (elements.petContextMenu && !elements.petContextMenu.classList.contains('hidden')) {
    elements.petContextMenu.classList.add('hidden');
  }
}

// DOM Element References
const elements = {
  root: document.getElementById('companion-root'),
  heroBadge: document.getElementById('hero-badge'),
  heroDot: document.getElementById('hero-dot'),
  heroName: document.getElementById('hero-name'),
  btnHeroMenu: document.getElementById('btn-hero-menu'),
  btnMinimize: document.getElementById('btn-minimize'),
  btnClose: document.getElementById('btn-close'),
  dialogueHud: document.getElementById('dialogue-hud'),
  bubbleHeader: document.getElementById('bubble-header'),
  hudIntent: document.getElementById('hud-intent'),
  hudOriginal: document.getElementById('hud-original'),
  hudMeaning: document.getElementById('hud-meaning'),
  suggestionContainer: document.getElementById('suggestion-container'),
  suggestionChips: document.getElementById('suggestion-chips'),
  btnCopyMeaning: document.getElementById('btn-copy-meaning'),
  btnCloseBubble: document.getElementById('btn-close-bubble'),
  petContainer: document.getElementById('pet-container'),
  petAvatar: document.getElementById('pet-avatar'),
  petStatusPill: document.getElementById('pet-status-pill'),
  statusText: document.getElementById('status-text'),
  visualizerRing: document.getElementById('visualizer-ring'),
  btnPttMic: document.getElementById('btn-ptt-mic'),
  pttLabel: document.getElementById('ptt-label'),
  btnTranslateClip: document.getElementById('btn-translate-clip'),
  toast: document.getElementById('hud-toast'),

  // Modal & Tabs
  heroModal: document.getElementById('hero-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  tabHeroList: document.getElementById('tab-hero-list'),
  tabHeroDetail: document.getElementById('tab-hero-detail'),
  tabWardrobe: document.getElementById('tab-wardrobe'),
  viewHeroesList: document.getElementById('view-heroes-list'),
  viewHeroDetail: document.getElementById('view-hero-detail'),
  viewWardrobe: document.getElementById('view-wardrobe'),
  totalHeroesCount: document.getElementById('total-heroes-count'),

  // Search & Filter
  heroSearchInput: document.getElementById('hero-search-input'),
  btnClearSearch: document.getElementById('btn-clear-search'),
  attrFilterTabs: document.getElementById('attr-filter-tabs'),
  selectComplexityFilter: document.getElementById('select-complexity-filter'),
  selectAttackFilter: document.getElementById('select-attack-filter'),
  heroesGrid: document.getElementById('heroes-grid'),

  // Selection Dock
  heroSelectionDock: document.getElementById('hero-selection-dock'),
  dockHeroThumb: document.getElementById('dock-hero-thumb'),
  dockHeroName: document.getElementById('dock-hero-name'),
  dockHeroDesc: document.getElementById('dock-hero-desc'),
  dockBtnDetail: document.getElementById('dock-btn-detail'),
  dockBtnEquip: document.getElementById('dock-btn-equip'),

  // Hero Detail Showcase
  detailHeroBanner: document.getElementById('detail-hero-banner'),
  detailHeroAvatar: document.getElementById('detail-hero-avatar'),
  detailHeroName: document.getElementById('detail-hero-name'),
  detailHeroAttr: document.getElementById('detail-hero-attr'),
  detailHeroComplexity: document.getElementById('detail-hero-complexity'),
  detailHeroEn: document.getElementById('detail-hero-en'),
  statStr: document.getElementById('stat-str'),
  statAgi: document.getElementById('stat-agi'),
  statInt: document.getElementById('stat-int'),
  statMs: document.getElementById('stat-ms'),
  statArmor: document.getElementById('stat-armor'),
  statRange: document.getElementById('stat-range'),
  detailStatsBar: document.getElementById('detail-stats-bar'),
  detailHypeTitle: document.getElementById('detail-hype-title'),
  detailHypeBox: document.getElementById('detail-hype-box'),
  detailAbilitiesTitle: document.getElementById('detail-abilities-title'),
  detailAbilitiesList: document.getElementById('detail-abilities-list'),
  detailCatchphrasesTitle: document.getElementById('detail-catchphrases-title'),
  detailCatchphrasesList: document.getElementById('detail-catchphrases-list'),
  btnEquipHero: document.getElementById('btn-equip-hero'),
  btnVoiceHero: document.getElementById('btn-voice-hero'),
  btnBackToGallery: document.getElementById('btn-back-to-gallery'),

  // Customization launcher
  wardrobeAvatarPreview: document.getElementById('wardrobe-avatar-preview'),
  wardrobeHeroName: document.getElementById('wardrobe-hero-name'),
  wardrobeSkinName: document.getElementById('wardrobe-skin-name'),

  // Snap & Roaming & Context Menu
  btnRoam: document.getElementById('btn-roam'),
  btnPin: document.getElementById('btn-pin'),
  btnScale: document.getElementById('btn-scale'),
  btnTranscript: document.getElementById('btn-transcript'),
  transcriptPanel: document.getElementById('transcript-panel'),
  transcriptList: document.getElementById('transcript-list'),
  transcriptEmpty: document.getElementById('transcript-empty'),
  btnCopyTranscript: document.getElementById('btn-copy-transcript'),
  btnClearTranscript: document.getElementById('btn-clear-transcript'),
  btnCloseTranscript: document.getElementById('btn-close-transcript'),
  transcriptJumpPill: document.getElementById('transcript-jump-pill'),
  btnSnap: document.getElementById('btn-snap'),
  snapPopover: document.getElementById('snap-popover'),
  petContextMenu: document.getElementById('pet-context-menu'),
  ctxHeroName: document.getElementById('ctx-hero-name'),
  ctxAttrBadge: document.getElementById('ctx-attr-badge'),
  ctxBtnVoice: document.getElementById('ctx-btn-voice'),
  ctxBtnTranslate: document.getElementById('ctx-btn-translate'),
  ctxBtnPhrases: document.getElementById('ctx-btn-phrases'),
  ctxBtnPin: document.getElementById('ctx-btn-pin'),
  ctxBtnScale: document.getElementById('ctx-btn-scale'),
  ctxScaleLabel: document.getElementById('ctx-scale-label'),
  ctxBtnProvider: document.getElementById('ctx-btn-provider'),
  ctxProviderLabel: document.getElementById('ctx-provider-label'),
  ctxBtnWardrobe: document.getElementById('ctx-btn-wardrobe'),
  ctxBtnHeroes: document.getElementById('ctx-btn-heroes'),
  ctxBtnSnapBr: document.getElementById('ctx-btn-snap-br'),
  ctxBtnSnapBl: document.getElementById('ctx-btn-snap-bl'),
  ctxBtnCenter: document.getElementById('ctx-btn-center'),
  ctxBtnHide: document.getElementById('ctx-btn-hide'),
  ctxBtnQuit: document.getElementById('ctx-btn-quit'),

  // Pet System Elements
  btnPetToggle: document.getElementById('btn-pet-toggle'),
  petModeBadge: document.getElementById('pet-mode-badge'),
  petQuickTools: document.getElementById('pet-quick-tools'),
  btnToolSpecial: document.getElementById('btn-tool-special'),
  btnToolTango: document.getElementById('btn-tool-tango'),
  btnToolSalve: document.getElementById('btn-tool-salve'),
  btnToolRapier: document.getElementById('btn-tool-rapier'),
  btnToolSnowball: document.getElementById('btn-tool-snowball'),
  btnToolMatrix: document.getElementById('btn-tool-matrix'),
  petMatrixPopover: document.getElementById('pet-matrix-popover'),
  ctxBtnPetMode: document.getElementById('ctx-btn-pet-mode'),
  ctxPetModeLabel: document.getElementById('ctx-pet-mode-label'),
  ctxBtnPetSpecial: document.getElementById('ctx-btn-pet-special'),
  ctxBtnPetFeedTango: document.getElementById('ctx-btn-pet-feed-tango'),
  ctxBtnPetFeedSalve: document.getElementById('ctx-btn-pet-feed-salve'),
  ctxBtnPetFeedRapier: document.getElementById('ctx-btn-pet-feed-rapier'),
  ctxBtnPetSnowball: document.getElementById('ctx-btn-pet-snowball'),
  tabPetMatrix: document.getElementById('tab-pet-matrix'),
  viewPetMatrix: document.getElementById('view-pet-matrix'),
  petMatrixGridView: document.getElementById('pet-matrix-grid-view'),
  totalPetsCount: document.getElementById('total-pets-count'),

  // GSI Elements
  gsiBadge: document.getElementById('gsi-badge'),
  gsiDot: document.getElementById('gsi-dot'),
  gsiLabel: document.getElementById('gsi-label'),
  gsiHudBar: document.getElementById('gsi-hud-bar'),
  gsiStatClock: document.getElementById('gsi-stat-clock'),
  gsiStatKda: document.getElementById('gsi-stat-kda'),
  gsiStatGold: document.getElementById('gsi-stat-gold'),
  ctxBtnGsi: document.getElementById('ctx-btn-gsi'),
  ctxGsiLabel: document.getElementById('ctx-gsi-label'),
  ctxBtnInstallGsi: document.getElementById('ctx-btn-install-gsi'),

};

/**
 * Pet State Machine Instance (Codex-Compatible Engine)
 */
const petStateMachine = new PetStateMachine({
  container: document.getElementById('companion-root'),
  avatarEl: document.getElementById('pet-avatar'),
  motionWrapEl: document.getElementById('pet-motion-wrap'),
  statusTextEl: document.getElementById('status-text'),
  statusPillEl: document.getElementById('pet-status-pill'),
  onQuote: (quote, pet) => {
    displayPetBubbleQuote(quote, pet);
  },
  onPetChanged: (pet) => {
    updatePetMatrixUI(pet);
    applyDesktopAppearance();
  },
  renderAvatar: (asset, petName) => {
    if (!state.isPetMode) return;
    const profile = customizationData?.profiles[`pet:${petName}`];
    const resolved = resolveAppearance(profile, customizationData?.assets || [], asset.src);
    elements.petAvatar.classList.add('is-svg-sprite');
    applyImageAppearance(elements.petAvatar, resolved);
    elements.petAvatar.onerror = () => { elements.petAvatar.src = asset.src; };
  },
});
// Pet manifests load asynchronously; persona sync & startup restore must wait
// for them (petMatrixReady) or the courier persona ships without its name/quotes.
const petMatrixReady = petStateMachine.init().then(() => {
  const savedPet = localStorage.getItem('voicespirit_active_pet');
  if (savedPet) {
    petStateMachine.switchPet(savedPet);
  }
});

/**
 * Global Pet Icon Mapping for the Matrix
 */
const PET_ICON_MAP = Object.freeze({
  aurora_wolf: '🐺',
  donkey_courier: '🫏',
  treant_sapling: '🌱',
  mischievous_greevil: '🐲',
  baby_roshan: '🌋',
});

function getPetIcon(petName) {
  return PET_ICON_MAP[petName] || '🐾';
}

function displayPetBubbleQuote(quote, pet = null) {
  if (!quote) return;
  const currentPet = pet || petStateMachine.getCurrentPet();
  const icon = getPetIcon(currentPet?.name);
  const displayName = currentPet?.displayName || 'DOTA 2 萌宠';

  if (elements.hudOriginal && elements.hudMeaning && elements.dialogueHud) {
    elements.hudOriginal.textContent = `${icon} ${displayName}:`;
    elements.hudMeaning.textContent = quote;
    if (elements.hudIntent) elements.hudIntent.textContent = 'PET';
    elements.dialogueHud.classList.remove('hidden');
    clearTimeout(window._petQuoteTimer);
    window._petQuoteTimer = setTimeout(() => {
      elements.dialogueHud.classList.add('hidden');
    }, 4500);
  }
}

function updatePetMatrixUI(pet) {
  if (!pet) return;
  const icon = getPetIcon(pet.name);

  if (elements.petModeBadge) {
    elements.petModeBadge.textContent = pet.displayName ? pet.displayName.split('·')[0].trim() : '萌宠跟班';
  }
  if (elements.ctxPetModeLabel) {
    elements.ctxPetModeLabel.textContent = pet.displayName || pet.name;
  }
  if (state.isPetMode) {
    if (elements.heroName) elements.heroName.textContent = pet.displayName || pet.name;
    if (elements.ctxHeroName) elements.ctxHeroName.textContent = pet.displayName || pet.name;
  }

  // Update active states in popover and context menu chips
  document.querySelectorAll('.pet-card-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-pet') === pet.name);
  });
  document.querySelectorAll('.ctx-pet-chip').forEach(chip => {
    chip.classList.toggle('active', chip.getAttribute('data-pet') === pet.name);
  });

  // Re-render modal view if visible
  if (state.activeModalTab === 'pet-matrix') {
    renderPetMatrixModalView();
  }
}

function switchPet(petName) {
  // Switch the actual pet FIRST, then (re)enter pet mode: the mode-on branch
  // syncs the persona of the NEW pet, so main sees exactly one setHero and a
  // live Google session never flashes the previous pet's persona.
  const success = petStateMachine.switchPet(petName);
  if (!success) {
    closePetMatrixPopover();
    closePetContextMenu();
    return;
  }
  localStorage.setItem('voicespirit_active_pet', petName);
  if (!state.isPetMode) {
    togglePetMode(true);
  } else {
    syncPetPersonaToMain();
  }
  const current = petStateMachine.getCurrentPet();
  showToast(`🐾 已切换桌面萌宠: ${current?.displayName || petName}`);
  closePetMatrixPopover();
  closePetContextMenu();
}

function togglePetMatrixPopover(e) {
  e?.stopPropagation();
  closeSnapPopover();
  closePetContextMenu();
  if (elements.petMatrixPopover) {
    elements.petMatrixPopover.classList.toggle('hidden');
  }
}

function closePetMatrixPopover() {
  if (elements.petMatrixPopover && !elements.petMatrixPopover.classList.contains('hidden')) {
    elements.petMatrixPopover.classList.add('hidden');
  }
}

/**
 * Display name of whoever is on stage: the desktop pet in pet mode, otherwise
 * the equipped hero. Drives every user-facing voice-chat label so a selected
 * courier never gets announced under a hero's name.
 */
function getActiveCompanionName() {
  if (state.isPetMode) {
    return petStateMachine.getCurrentPet()?.displayName || 'DOTA 2 萌宠';
  }
  return state.currentHero?.nameZh || '英雄伴侣';
}

// Bounds the one-shot deferred retry in syncPetPersonaToMain so a pet matrix
// that never loads cannot spin the microtask queue.
let petPersonaSyncRetried = false;

/**
 * Push pet mode / pet selection to the main process so the voice engine's
 * persona follows whatever is on the desktop. Without this the mic session
 * keeps the last-equipped hero persona ("选了信使，开口却是英雄").
 */
function syncPetPersonaToMain() {
  const pet = state.isPetMode ? petStateMachine.getCurrentPet() : null;
  if (state.isPetMode && !pet) {
    // Alt+P landed before the manifests finished loading: defer one retry
    // until petMatrixReady instead of leaving the hero voice latched.
    if (!petPersonaSyncRetried) {
      petPersonaSyncRetried = true;
      petMatrixReady.then(() => {
        if (state.isPetMode) syncPetPersonaToMain();
      }).catch(() => {});
    }
    return;
  }
  petPersonaSyncRetried = false;
  const payload = pet
    ? {
        name: pet.name,
        displayName: pet.displayName,
        description: pet.description,
        themeColor: pet.themeColor,
        catchphrases: extractPetCatchphrases(pet),
      }
    : null;
  window.electronAPI?.syncPetPersona?.({ isPetMode: state.isPetMode, pet: payload })
    ?.catch?.((err) => console.warn('[Pet] Persona sync failed:', err));
}

// Monotonic token for togglePetMode: a stale pet-off continuation (it awaits a
// getCurrentHero roundtrip) must not repaint hero UI over a re-enabled pet.
let petModeEpoch = 0;

async function togglePetMode(forced = null, opts = {}) {
  const next = (forced !== null) ? forced : !state.isPetMode;
  if (next === state.isPetMode) return;
  const epoch = ++petModeEpoch;
  state.isPetMode = next;
  petStateMachine.setPetMode(state.isPetMode);
  // Persist so a chosen courier survives restarts instead of silently
  // reverting to hero mode.
  localStorage.setItem('voicespirit_pet_mode', state.isPetMode ? '1' : '0');

  const currentPet = petStateMachine.getCurrentPet();
  if (state.isPetMode) {
    if (elements.btnPetToggle) elements.btnPetToggle.classList.add('active');
    if (elements.heroName) elements.heroName.textContent = currentPet?.displayName || 'DOTA 2 萌宠';
    if (elements.ctxHeroName) elements.ctxHeroName.textContent = currentPet?.displayName || 'DOTA 2 萌宠';
    if (elements.ctxPetModeLabel) elements.ctxPetModeLabel.textContent = `已开启 (${currentPet?.name || 'Pet'})`;
    if (!opts.silent) showToast(`🐾 已进入 DOTA2 萌宠跟班模式 (${currentPet?.displayName || '萌宠'})`);
    const quote = petStateMachine.loader.getPetStateAsset(petStateMachine.currentPetName, 'idle')?.quote;
    displayPetBubbleQuote(quote || '嗷呜~ 召唤师！萌宠随时待命，可以摸摸头或喂我吃树哦！', currentPet);
  } else {
    if (elements.btnPetToggle) elements.btnPetToggle.classList.remove('active');
    // The equipped hero may have changed while the pet was on stage
    // (tray switch / GSI auto-sync); re-read it instead of trusting the cache.
    let hero = state.currentHero;
    try {
      const fresh = await window.electronAPI?.getCurrentHero?.();
      if (fresh) hero = fresh;
    } catch (e) {}
    if (epoch !== petModeEpoch) return; // superseded by a newer toggle
    state.currentHero = hero;
    if (hero) {
      if (elements.heroName) elements.heroName.textContent = hero.nameZh || hero.name;
      if (elements.ctxHeroName) elements.ctxHeroName.textContent = hero.nameZh || hero.name;
    }
    if (elements.ctxPetModeLabel) elements.ctxPetModeLabel.textContent = `切换为萌宠 (${currentPet?.displayName || 'Pet'})`;
    applyHeroSkin(hero);
    if (!opts.silent) showToast('🎭 已切回 DOTA2 英雄伴侣模式');
  }
  syncPetPersonaToMain();
  applyDesktopAppearance();
}

function renderPetMatrixModalView() {
  if (!elements.petMatrixGridView) return;
  const pets = petStateMachine.getAvailablePets();
  const currentPetName = petStateMachine.currentPetName;

  elements.petMatrixGridView.innerHTML = pets.map(p => {
    const isActive = p.name === currentPetName && state.isPetMode;
    const icon = getPetIcon(p.name);
    const skill = p.specialSkill || { name: '专属绝招', icon: '✨' };

    return `
      <div class="pet-matrix-item-card ${isActive ? 'is-active-pet' : ''}" data-pet-card="${p.name}">
        <div class="pet-item-head">
          <div class="pet-item-thumb">
            <img src="${p.basePath}/idle.svg" alt="${p.displayName}" />
          </div>
          <div class="pet-item-headline">
            <span class="pet-item-name">${icon} ${p.displayName}</span>
            <span class="pet-item-badge">v${p.version}</span>
          </div>
        </div>
        <div class="pet-item-desc">${p.description}</div>
        <div class="pet-item-skill">${skill.icon} 绝招: <b>${skill.name}</b> - ${skill.description || ''}</div>
        <div class="pet-item-actions">
          <button class="pet-btn-summon ${isActive ? 'active-summoned' : ''}" data-summon-pet="${p.name}">
            ${isActive ? '✅ 当前跟随' : '✨ 召唤出战'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  elements.petMatrixGridView.querySelectorAll('[data-summon-pet]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetPet = btn.getAttribute('data-summon-pet');
      if (targetPet) {
        switchPet(targetPet);
        closeHeroModal();
      }
    });
  });
}

/**
 * Generate a stylized SVG avatar with the hero's initial and attribute gradient
 */
function generateFallbackAvatarSvg(nameZh, attr = 'str') {
  const char = (nameZh || '英').trim().slice(0, 1);
  const gradients = {
    str: ['#ef4444', '#7f1d1d'],
    agi: ['#10b981', '#064e3b'],
    int: ['#06b6d4', '#1e3a8a'],
    all: ['#eab308', '#78350f'],
  };
  const [c1, c2] = gradients[attr] || gradients.str;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
    </defs>
    <circle cx="32" cy="32" r="32" fill="url(#g)"/>
    <text x="32" y="42" font-size="28" font-weight="bold" fill="#ffffff" text-anchor="middle" font-family="sans-serif">${char}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Setup Dynamic Click-Through Hit Testing
 */
function setupHitTesting() {
  if (!window.electronAPI?.setIgnoreMouseEvents) return;

  let currentIgnore = null;

  const setIgnoreState = (ignore, options = {}) => {
    if (currentIgnore === ignore) return;
    currentIgnore = ignore;
    window.electronAPI.setIgnoreMouseEvents(ignore, options);
  };

  window.addEventListener('mousemove', (event) => {
    // If modal, context menu, popover is open, or during drag, or while roaming, always capture mouse events directly
    const isModalOpen = elements.heroModal && !elements.heroModal.classList.contains('hidden');
    const isMenuOpen = elements.petContextMenu && !elements.petContextMenu.classList.contains('hidden');
    const isPopoverOpen = (elements.snapPopover && !elements.snapPopover.classList.contains('hidden')) ||
      (elements.petMatrixPopover && !elements.petMatrixPopover.classList.contains('hidden'));

    if (state.isDragging || roamState.isRoaming || isModalOpen || isMenuOpen || isPopoverOpen) {
      setIgnoreState(false);
      return;
    }

    const el = document.elementFromPoint(event.clientX, event.clientY);
    const isInteractive = el && (
      el.closest('.interactive') ||
      el.closest('.hud-top-bar') ||
      el.closest('.transcript-panel') ||
      el.closest('.pet-wrapper') ||
      el.closest('.pet-avatar-container') ||
      el.closest('.dialogue-bubble') ||
      el.closest('.hud-bottom-dock') ||
      el.closest('.snap-popover') ||
      el.closest('.pet-matrix-popover') ||
      el.closest('.pet-context-menu') ||
      el.closest('.hero-picker-modal') ||
      el.closest('button') ||
      el.closest('input') ||
      el.closest('select')
    );

    if (isInteractive) {
      setIgnoreState(false);
    } else {
      setIgnoreState(true, { forward: true });
    }
  });

  window.addEventListener('mouseleave', () => {
    if (state.isDragging) return;
    const isModalOpen = elements.heroModal && !elements.heroModal.classList.contains('hidden');
    if (!isModalOpen) {
      setIgnoreState(true, { forward: true });
    }
  });
}

/**
 * Get active skin data for a hero (checking localStorage overrides)
 */
function getActiveHeroSkin(hero) {
  if (!hero) return null;
  const sharedProfile = customizationData?.profiles[`hero:${hero.id}`];
  if (sharedProfile) {
    const profile = normalizeProfile(sharedProfile);
    const builtin = hero.skins?.[profile.appearance.builtinId];
    const asset = customizationData.assets.find(item => item.id === profile.appearance.assetId);
    return {
      id: asset?.id || builtin?.id || 'classic', name: asset?.name || builtin?.nameZh || builtin?.name || '内置形象',
      sprites: asset ? { idle: asset.url, speaking: asset.url, action: asset.url } : builtin?.sprites || hero.sprites,
      themeColor: profile.accent || builtin?.themeColor || hero.themeColor,
    };
  }
  const fallback = generateFallbackAvatarSvg(hero.nameZh, hero.attribute);
  const heroDefaultSprites = hero.sprites || {
    idle: hero.photoUrl || fallback,
    speaking: hero.photoUrl || fallback,
    action: hero.photoUrl || fallback,
  };

  const savedSkinKey = `voicespirit_active_skin_${hero.id}`;
  const savedSkinId = localStorage.getItem(savedSkinKey);

  // Check custom uploaded skin from localStorage
  if (savedSkinId && savedSkinId.startsWith('custom_')) {
    const customSkinsJson = localStorage.getItem(`voicespirit_custom_skins_${hero.id}`);
    if (customSkinsJson) {
      try {
        const customSkins = JSON.parse(customSkinsJson);
        if (customSkins[savedSkinId]) {
          return {
            ...customSkins[savedSkinId],
            sprites: customSkins[savedSkinId].sprites || heroDefaultSprites,
          };
        }
      } catch (e) {
        console.error('Failed to parse custom skin:', e);
      }
    }
  }

  // Check predefined skins from config
  if (hero.skins && Object.keys(hero.skins).length > 0) {
    let chosenSkin = null;
    if (savedSkinId && hero.skins[savedSkinId]) {
      chosenSkin = hero.skins[savedSkinId];
    } else {
      chosenSkin = hero.skins.classic || Object.values(hero.skins)[0];
    }

    if (chosenSkin) {
      return {
        ...chosenSkin,
        sprites: chosenSkin.sprites || heroDefaultSprites,
      };
    }
  }

  return {
    id: 'classic',
    name: '经典原版',
    rarity: 'common',
    sprites: heroDefaultSprites,
  };
}

/**
 * Set Pet Avatar Visual State
 * @param {'idle' | 'speaking' | 'action'} spriteType
 */
function setPetSprite(spriteType) {
  if (state.isPetMode) {
    petStateMachine.setState(spriteType === 'speaking' ? 'speak' : 'idle');
    return;
  }
  if (!state.currentHero) return;
  const activeSkin = getActiveHeroSkin(state.currentHero);
  const skinSprites = activeSkin?.sprites || state.currentHero.sprites;

  let spritePath = skinSprites?.[spriteType] || skinSprites?.idle || state.currentHero.photoUrl;
  if (!spritePath) {
    spritePath = generateFallbackAvatarSvg(state.currentHero.nameZh, state.currentHero.attribute);
  }

  const isSvg = spritePath.startsWith('data:image/svg+xml') ||
    spritePath.toLowerCase().endsWith('.svg') ||
    spritePath.includes('/assets/heroes/');

  elements.petAvatar.classList.toggle('is-svg-sprite', isSvg);

  const themeColor = activeSkin?.themeColor || state.currentHero.themeColor || '#f59e0b';
  if (!isSvg) {
    elements.petAvatar.style.borderColor = themeColor;
    elements.petAvatar.style.boxShadow = `0 0 16px ${themeColor}45, 0 8px 24px rgba(0, 0, 0, 0.65)`;
  } else {
    elements.petAvatar.style.borderColor = 'transparent';
    elements.petAvatar.style.boxShadow = 'none';
  }

  if (elements.petAvatar.src !== spritePath) {
    elements.petAvatar.src = spritePath;
    elements.petAvatar.onerror = () => {
      elements.petAvatar.src = generateFallbackAvatarSvg(state.currentHero.nameZh, state.currentHero.attribute);
      elements.petAvatar.classList.add('is-svg-sprite');
    };
  }
  const resolved = resolveAppearance(customizationData?.profiles[`hero:${state.currentHero.id}`], customizationData?.assets || [], spritePath, state.currentHero.skins || {}, spriteType);
  applyImageAppearance(elements.petAvatar, resolved);
}

function applyDesktopAppearance() {
  const pet = state.isPetMode ? petStateMachine.getCurrentPet() : null;
  const key = pet ? `pet:${pet.name}` : `hero:${state.currentHero?.id}`;
  const profile = normalizeProfile(customizationData?.profiles[key]);
  const background = document.getElementById('companion-scene-background');
  applyBackground(background, profile, customizationData?.assets || []);
  if (profile.background.scope !== 'scene' && background) background.hidden = true;
  if (pet) {
    const asset = petStateMachine.loader.getPetStateAsset(pet.name, petStateMachine.currentState);
    if (asset) petStateMachine.renderAvatar?.(asset, pet.name);
  } else if (state.currentHero) {
    setPetSprite(state.appState === 'speaking' ? 'speaking' : 'idle');
  }
  const accent = profile.accent || (pet ? pet.themeColor : getActiveHeroSkin(state.currentHero)?.themeColor);
  if (accent) {
    document.documentElement.style.setProperty('--pet-theme-color', accent);
    elements.heroDot.style.background = accent;
    elements.visualizerRing.style.borderColor = accent;
    elements.petStatusPill.style.borderColor = accent;
  }
  updateWardrobeView();
}

async function loadCustomization({ migrate = false } = {}) {
  if (!window.electronAPI?.getCustomization) return;
  if (migrate) {
    const entries = [];
    const heroIds = new Set(['companion', ...Object.keys(state.heroesConfig?.heroes || {})]);
    for (let i = 0; i < localStorage.length; i++) {
      const match = /^voicespirit_(?:custom_skins|active_skin)_([a-z0-9_]+)$/.exec(localStorage.key(i));
      if (match) heroIds.add(match[1]);
    }
    let invalidLegacy = false;
    for (const heroId of heroIds) {
      const activeSkinId = localStorage.getItem(`voicespirit_active_skin_${heroId}`);
      const raw = localStorage.getItem(`voicespirit_custom_skins_${heroId}`);
      if (!activeSkinId && !raw) continue;
      let skins = {};
      try { if (raw) skins = JSON.parse(raw); } catch { invalidLegacy = true; console.warn('[Customize] Invalid legacy skin JSON:', heroId); }
      entries.push({ heroId, activeSkinId, skins });
    }
    if (entries.length) {
      const migrated = await window.electronAPI.migrateCustomization(entries);
      if (!migrated?.ok || migrated.warnings?.length || invalidLegacy) showToast('部分旧图片迁移失败，原始设置已保留。');
    }
  }
  const result = await window.electronAPI.getCustomization();
  if (!result?.ok) throw new Error(result?.error || '自定义配置读取失败');
  customizationData = result.state;
  applyDesktopAppearance();
}

/**
 * Update UI Status (idle, listening, thinking, speaking)
 */
function setAppState(newStatus, label = null) {
  state.appState = newStatus;

  if (state.isPetMode) {
    if (newStatus === 'listening' || newStatus === 'thinking') {
      petStateMachine.setState('think');
    } else if (newStatus === 'speaking') {
      petStateMachine.setState('speak');
    } else if (newStatus === 'idle') {
      petStateMachine.setState('idle');
    }
    return;
  }

  elements.petStatusPill.className = `status-pill status-${newStatus}`;

  const labels = {
    idle: '待命中',
    listening: '聆听中...',
    thinking: '思考中...',
    speaking: '讲解中...',
  };

  elements.statusText.textContent = label || labels[newStatus] || '待命';
  elements.visualizerRing.className = `visualizer-ring ${newStatus}`;

  if (newStatus === 'speaking') {
    setPetSprite('speaking');
  } else {
    setPetSprite('idle');
  }
}

/**
 * Load Hero Configuration & Apply Skin
 */
async function loadHeroConfig() {
  if (!window.electronAPI) return;

  try {
    state.heroesConfig = await window.electronAPI.getHeroesConfig();
    state.currentHero = await window.electronAPI.getCurrentHero();
    
    const count = Object.keys(state.heroesConfig?.heroes || {}).length;
    if (elements.totalHeroesCount) {
      elements.totalHeroesCount.textContent = count || 127;
    }
    
    applyHeroSkin(state.currentHero);
  } catch (err) {
    console.error('Failed to load hero configuration:', err);
  }
}

function applyHeroSkin(hero) {
  if (!hero) return;
  state.currentHero = hero;

  const activeSkin = getActiveHeroSkin(hero);
  const themeColor = activeSkin?.themeColor || hero.themeColor || '#f59e0b';

  // If active skin is a Persona / Arcana with custom personaConfig, dynamically link persona AI
  if (activeSkin?.personaConfig) {
    hero.activeSystemPrompt = activeSkin.personaConfig.systemPrompt || hero.systemPrompt;
    hero.activeVoiceProfile = activeSkin.personaConfig.voiceProfile || hero.voiceProfile;
    hero.activeCatchphrases = activeSkin.personaConfig.catchphrases || hero.catchphrases;
  } else {
    hero.activeSystemPrompt = hero.systemPrompt;
    hero.activeVoiceProfile = hero.voiceProfile;
    hero.activeCatchphrases = hero.catchphrases;
  }

  const skinLabel = activeSkin?.nameZh || activeSkin?.name;
  elements.heroName.textContent = (skinLabel && activeSkin.id !== 'classic')
    ? `${hero.nameZh} · ${skinLabel}`
    : (hero.nameZh || hero.nameEn);

  elements.heroDot.style.background = themeColor;
  elements.heroDot.style.boxShadow = `0 0 10px ${themeColor}`;
  elements.visualizerRing.style.borderColor = themeColor;

  setPetSprite('idle');
  updateWardrobeView();
  applyDesktopAppearance();
}

let bubbleDismissTimer = null;

function cleanMarkdownForDisplay(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#+\s+/gm, '')
    .trim();
}

function hideDialogueHUD() {
  if (bubbleDismissTimer) {
    clearTimeout(bubbleDismissTimer);
    bubbleDismissTimer = null;
  }
  if (elements.dialogueHud) {
    elements.dialogueHud.classList.add('hidden');
  }
  document.body.classList.remove('has-dialogue-active');
}

// ==========================================
// Real-time Conversation Transcript Panel
// Streams what the Summoner said and what the hero replied, line by line.
// ==========================================
const TRANSCRIPT_MAX_MESSAGES = 40;
// Hysteresis band: streaming deltas and sub-pixel rounding must not flip the
// sticky state while the user is visually reading the latest lines.
const TRANSCRIPT_STICK_THRESHOLD_PX = 32;
const TRANSCRIPT_MSG_GAP_PX = 5; // keep in sync with .transcript-list column gap
let transcriptUserEl = null;  // interim (still-recognizing) user message element
let transcriptAgentEl = null; // streaming hero reply element
let transcriptStickToBottom = true;

function showTranscriptPanel() {
  elements.transcriptPanel?.classList.remove('hidden');
}

function isTranscriptAtBottom() {
  const list = elements.transcriptList;
  if (!list) return true;
  return list.scrollHeight - list.scrollTop - list.clientHeight <= TRANSCRIPT_STICK_THRESHOLD_PX;
}

function scrollTranscriptToBottom() {
  const list = elements.transcriptList;
  if (!list) return;
  list.scrollTop = list.scrollHeight;
}

function updateTranscriptJumpPill() {
  const pill = elements.transcriptJumpPill;
  const list = elements.transcriptList;
  if (!pill || !list) return;
  const hasOverflow = list.scrollHeight > list.clientHeight + 1;
  pill.classList.toggle('visible', !transcriptStickToBottom && hasOverflow);
}

function pruneTranscript() {
  if (!elements.transcriptList) return;
  const list = elements.transcriptList;
  const msgs = list.querySelectorAll('.transcript-msg');
  const overflowCount = msgs.length - TRANSCRIPT_MAX_MESSAGES;
  if (overflowCount <= 0) return;
  let removedHeight = 0;
  for (let i = 0; i < overflowCount; i++) {
    removedHeight += msgs[i].offsetHeight + TRANSCRIPT_MSG_GAP_PX;
    msgs[i].remove();
  }
  // Deleting above the viewport shifts content up; compensate so a user who is
  // browsing history keeps their place instead of seeing the view jump.
  if (!transcriptStickToBottom) {
    list.scrollTop = Math.max(0, list.scrollTop - removedHeight);
  }
}

function newTranscriptMessage(roleLabel, roleClass) {
  if (!elements.transcriptList) return null;
  elements.transcriptEmpty?.classList.add('hidden');
  const msg = document.createElement('div');
  msg.className = `transcript-msg ${roleClass}`;
  const role = document.createElement('span');
  role.className = 'msg-role';
  role.textContent = roleLabel;
  const text = document.createElement('span');
  text.className = 'msg-text';
  msg.appendChild(role);
  msg.appendChild(text);
  elements.transcriptList.appendChild(msg);
  pruneTranscript();
  // Live updates must never steal the viewport from a user who scrolled up to
  // read history; stickiness is re-engaged by the list's scroll listener.
  if (transcriptStickToBottom) {
    scrollTranscriptToBottom();
  }
  return msg;
}

function setTranscriptText(msgEl, text) {
  if (!msgEl) return;
  const textEl = msgEl.querySelector('.msg-text');
  if (textEl) textEl.textContent = text;
  if (transcriptStickToBottom) {
    scrollTranscriptToBottom();
  }
}

function resetTranscriptStreamRefs() {
  transcriptUserEl = null;
  transcriptAgentEl = null;
}

/**
 * Render In-Game Translation HUD Bubble or Clean Companion Greeting
 */
function displayTranslationHUD(data) {
  if (!data) return;

  if (bubbleDismissTimer) {
    clearTimeout(bubbleDismissTimer);
    bubbleDismissTimer = null;
  }

  const isGreeting = data.isGreeting || data.intent === 'greeting' || data.intent === 'quote';

  elements.hudOriginal.textContent = data.original ? `"${cleanMarkdownForDisplay(data.original)}"` : '';
  elements.hudMeaning.textContent = cleanMarkdownForDisplay(data.meaningZh) || '已获取对局翻译';

  // Smoothly auto-scroll to bottom to follow live speaking / text streaming
  requestAnimationFrame(() => {
    if (elements.hudMeaning) {
      elements.hudMeaning.scrollTop = elements.hudMeaning.scrollHeight;
    }
  });

  document.body.classList.add('has-dialogue-active');

  if (isGreeting) {
    elements.dialogueHud.classList.add('is-greeting-bubble');
    if (elements.bubbleHeader) elements.bubbleHeader.style.display = 'none';
    if (elements.suggestionContainer) elements.suggestionContainer.style.display = 'none';
  } else {
    elements.dialogueHud.classList.remove('is-greeting-bubble');
    if (elements.bubbleHeader) elements.bubbleHeader.style.display = '';
    if (elements.suggestionContainer) elements.suggestionContainer.style.display = '';

    const intent = (data.intent || 'info').toUpperCase();
    elements.hudIntent.textContent = intent;
    if (intent === 'FLAME') {
      elements.hudIntent.style.background = '#ef4444';
    } else if (intent === 'STRATEGY') {
      elements.hudIntent.style.background = '#10b981';
    } else if (intent === 'REQUEST') {
      elements.hudIntent.style.background = '#f59e0b';
    } else {
      elements.hudIntent.style.background = '#0284c7';
    }

    // Reply Suggestion Chips
    elements.suggestionChips.innerHTML = '';
    const suggestions = data.suggestions || ['push mid', 'b b b', 'well played'];

    suggestions.forEach((text) => {
      const chip = document.createElement('button');
      chip.className = 'chip-btn interactive';
      chip.textContent = text;
      chip.title = `点击复制 "${text}" (DOTA2 对局回复)`;
      chip.addEventListener('click', () => {
        copyText(text);
        chip.textContent = `✓ ${text}`;
        chip.style.borderColor = '#10b981';
        chip.style.color = '#34d399';
        setTimeout(() => {
          chip.textContent = text;
          chip.style.borderColor = '';
          chip.style.color = '';
        }, 1200);
      });
      elements.suggestionChips.appendChild(chip);
    });
  }

  elements.dialogueHud.classList.remove('hidden');

  setPetSprite('action');
  setTimeout(() => {
    if (state.appState === 'idle') setPetSprite('idle');
  }, 1200);

  if (isGreeting || data.autoDismissMs) {
    const dismissMs = data.autoDismissMs || 3500;
    bubbleDismissTimer = setTimeout(() => {
      hideDialogueHUD();
    }, dismissMs);
  }
}

/**
 * Microphone Capture & Web Audio Downsampling
 */
async function startMicrophone() {
  if (state.isMicStarting || state.isMicActive) return;
  // Cloud voice is opt-in: without a connected provider the captured audio
  // would vanish into a disconnected engine, so explain instead of playing
  // dumb. Local features (翻译/GSI 播报) do not need the mic.
  if (!state.voiceConnected) {
    showToast('先设置语音：填写密钥 → 测试 → 连接，再按 Alt+Q 讲话');
    window.electronAPI?.openAISettings?.('voice');
    return;
  }
  const generation = ++state.microphoneGeneration;
  state.isMicStarting = true;
  try {
    showToast('正在打开麦克风…');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    if (generation !== state.microphoneGeneration || !state.voiceConnected) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    state.mediaStream = stream;
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const source = state.audioContext.createMediaStreamSource(stream);

    const bufferSize = 4096;
    state.scriptProcessor = state.audioContext.createScriptProcessor(bufferSize, 1, 1);

    state.scriptProcessor.onaudioprocess = (e) => {
      if (!state.isMicActive) return;
      const inputData = e.inputBuffer.getChannelData(0);
      
      const pcm16 = new Int16Array(inputData.length);
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        sum += s * s;
      }

      const rms = Math.sqrt(sum / inputData.length);
      // Dynamic speech thresholding: raise threshold when companion is speaking to resist speaker bleed
      const isAssistantActive = audioPlayer && typeof audioPlayer.isPlaying === 'function' && audioPlayer.isPlaying();
      const speechThreshold = isAssistantActive ? 0.06 : 0.025;
      if (rms > speechThreshold) {
        setAppState('listening', '正在说话...');
      }

      if (window.electronAPI) {
        window.electronAPI.sendAudioChunk(pcm16.buffer);
      }
    };

    // Avoid acoustic feedback loop: ScriptProcessorNode requires a downstream connection to keep
    // firing onaudioprocess in Chromium, but connecting directly to destination loops mic into speakers!
    // Route through a zero-gain node instead.
    const muteGain = state.audioContext.createGain();
    muteGain.gain.value = 0;
    source.connect(state.scriptProcessor);
    state.scriptProcessor.connect(muteGain);
    muteGain.connect(state.audioContext.destination);

    state.isMicActive = true;
    elements.btnPttMic.classList.add('active');
    elements.pttLabel.textContent = '停止语音';
    setAppState('listening', '正在聆听...');
    showToast('🎙️ 麦克风已开启，再点一次或按 Alt+Q 关闭');
  } catch (err) {
    if (generation !== state.microphoneGeneration) return;
    state.mediaStream?.getTracks().forEach(track => track.stop()); state.mediaStream = null;
    state.audioContext?.close().catch(() => {}); state.audioContext = null;
    console.error('Error accessing microphone:', err);
    showToast('麦克风没有打开。请在语音设置里点击「麦克风检查」，查看设备和权限。');
  } finally {
    if (generation === state.microphoneGeneration) state.isMicStarting = false;
  }
}

function stopMicrophone() {
  state.microphoneGeneration++;
  state.isMicStarting = false;
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((t) => t.stop());
    state.mediaStream = null;
  }
  if (state.audioContext) {
    state.audioContext.close();
    state.audioContext = null;
  }
  state.isMicActive = false;
  // Speech possibly pending when the mic is switched off: the Gemini
  // flash-live generation only commits turns on audioStreamEnd, so force it.
  window.electronAPI?.commitVoiceUtterance?.();
  elements.btnPttMic.classList.remove('active');
  elements.pttLabel.textContent = '语音';
  setAppState('idle', '待命中');
  showToast('🎙️ 语音对讲已结束');
}

function toggleMicrophone() {
  if (state.isMicActive || state.isMicStarting) {
    stopMicrophone();
  } else {
    startMicrophone();
  }
}

/**
 * Copy text helper with toast
 */
function copyText(text) {
  if (!text) return;
  if (window.electronAPI) {
    window.electronAPI.copyToClipboard(text);
  } else {
    navigator.clipboard.writeText(text);
  }
  showToast(`已复制: "${text}"`);
}

let toastTimer = null;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  // Clear the previous dismissal first, or a rapid second toast gets hidden
  // by the first toast's stale timer.
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 1800);
}


/**
 * Equip and switch the active hero companion
 */
async function equipSelectedHero(hero) {
  if (!hero) return;
  // "装配英雄出战" is an explicit hero-companion request: leave pet mode first
  // so the voice persona follows the newly equipped hero, not the courier.
  if (state.isPetMode) {
    await togglePetMode(false);
  }
  state.currentHero = hero;
  state.selectedDetailHero = hero;
  localStorage.setItem('voicespirit_selected_hero_id', hero.id);

  if (window.electronAPI?.selectHero) {
    const updated = await window.electronAPI.selectHero(hero.id);
    applyHeroSkin(updated || hero);
  } else {
    applyHeroSkin(hero);
  }

  renderHeroesGrid();
  updateDetailEquipButton(hero);
  showToast(`✨ 已切换出战伴侣为：${hero.nameZh}`);

  if (hero.catchphrases && hero.catchphrases.length > 0) {
    displayTranslationHUD({
      original: `${hero.nameZh} · 已就绪`,
      meaningZh: hero.catchphrases[0],
      isGreeting: true,
      autoDismissMs: 3500,
    });
  }
}

function updateDetailEquipButton(hero) {
  if (!elements.btnEquipHero || !hero) return;
  const isEquipped = state.currentHero?.id === hero.id;
  if (isEquipped) {
    elements.btnEquipHero.textContent = '✔ 当前已出战';
    elements.btnEquipHero.classList.add('is-equipped');
  } else {
    elements.btnEquipHero.textContent = '✨ 装配为此英雄伴侣出战';
    elements.btnEquipHero.classList.remove('is-equipped');
  }
}

/**
 * Update the bottom selected hero dock preview & actions
 */
function updateSelectionDock(hero) {
  if (!elements.heroSelectionDock || !hero) return;
  state.selectedGalleryHero = hero;

  const fallbackSvg = generateFallbackAvatarSvg(hero.nameZh, hero.attribute);
  if (elements.dockHeroThumb) {
    elements.dockHeroThumb.src = hero.sprites?.idle || hero.photoUrl || fallbackSvg;
    elements.dockHeroThumb.onerror = () => {
      elements.dockHeroThumb.src = fallbackSvg;
    };
  }

  const attrLabels = { str: '力量', agi: '敏捷', int: '智力', all: '全能', uni: '全能' };
  const attrText = attrLabels[hero.attribute] || '力量';
  const attackText = hero.attackType === 'Ranged' ? '远程' : '近战';

  if (elements.dockHeroName) elements.dockHeroName.textContent = hero.nameZh;
  if (elements.dockHeroDesc) elements.dockHeroDesc.textContent = `${attrText} · ${attackText} · ${hero.nameEn || ''}`;

  const isEquipped = state.currentHero?.id === hero.id;
  if (elements.dockBtnEquip) {
    if (isEquipped) {
      elements.dockBtnEquip.textContent = '✔ 出战中';
      elements.dockBtnEquip.classList.add('is-equipped');
    } else {
      elements.dockBtnEquip.textContent = '✨ 出战';
      elements.dockBtnEquip.classList.remove('is-equipped');
    }
  }
}

/**
 * Render Heroes Grid with Multi-Dimensional Search & Filtering (Clean 3-Column Tiles)
 */
function renderHeroesGrid() {
  if (!state.heroesConfig?.heroes) return;
  elements.heroesGrid.innerHTML = '';

  const q = (state.searchQuery || '').trim().toLowerCase();
  const filterAttr = state.selectedAttrFilter; // 'all' | 'str' | 'agi' | 'int' | 'uni'
  const filterComp = state.selectedComplexityFilter; // 'all' | '1' | '2' | '3'
  const filterAttack = state.selectedAttackFilter; // 'all' | 'Melee' | 'Ranged'

  const allHeroes = Object.values(state.heroesConfig.heroes);
  const filtered = allHeroes.filter((hero) => {
    // 1. Attribute filter
    if (filterAttr !== 'all') {
      const heroAttr = (hero.attribute === 'all' || hero.attribute === 'uni') ? 'uni' : hero.attribute;
      if (heroAttr !== filterAttr) return false;
    }
    // 2. Complexity filter
    if (filterComp !== 'all') {
      if (String(hero.complexity || 1) !== String(filterComp)) return false;
    }
    // 3. Attack Type filter
    if (filterAttack !== 'all') {
      if (hero.attackType !== filterAttack) return false;
    }
    // 4. Multi-field search query filter
    if (q) {
      const nameZh = (hero.nameZh || '').toLowerCase();
      const nameEn = (hero.nameEn || '').toLowerCase();
      const id = (hero.id || '').toLowerCase();
      const aliases = (hero.aliases || []).map((a) => a.toLowerCase());
      const matchesSearch =
        nameZh.includes(q) ||
        nameEn.includes(q) ||
        id.includes(q) ||
        aliases.some((alias) => alias.includes(q));
      if (!matchesSearch) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    const emptyNotice = document.createElement('div');
    emptyNotice.style.cssText = 'grid-column: 1 / -1; text-align: center; color: #a3947a; padding: 25px 10px; font-size: 11.5px;';
    emptyNotice.textContent = '未找到匹配英雄 (支持拼音 / 英文 / 别名如 SF / AM / 白牛)';
    elements.heroesGrid.appendChild(emptyNotice);
    return;
  }

  // Ensure active selection in dock
  if (!state.selectedGalleryHero || !filtered.some((h) => h.id === state.selectedGalleryHero.id)) {
    state.selectedGalleryHero = filtered.find((h) => h.id === state.currentHero?.id) || filtered[0];
  }
  updateSelectionDock(state.selectedGalleryHero);

  const attrDots = {
    str: '🔴',
    agi: '🟢',
    int: '🔵',
    uni: '🟡',
    all: '🟡',
  };

  filtered.forEach((hero) => {
    const card = document.createElement('div');
    const isEquipped = state.currentHero?.id === hero.id;
    const isSelected = state.selectedGalleryHero?.id === hero.id;

    card.className = `hero-card interactive ${isSelected ? 'active-selection' : ''} ${isEquipped ? 'equipped-hero' : ''}`;
    card.dataset.heroId = hero.id;

    const attrKey = (hero.attribute === 'all' || hero.attribute === 'uni') ? 'uni' : (hero.attribute || 'str');
    const fallbackSvg = generateFallbackAvatarSvg(hero.nameZh, hero.attribute);
    const imgSrc = hero.sprites?.idle || hero.photoUrl || fallbackSvg;

    card.innerHTML = `
      <div class="hero-card-img-wrap">
        <img class="hero-card-img" src="${imgSrc}" alt="${hero.nameZh}" loading="lazy" />
        <span class="hero-card-attr-dot ${attrKey}">${attrDots[attrKey] || '🔴'}</span>
        ${isEquipped ? '<span class="hero-card-laurel-badge" title="当前出战桌宠伴侣">👑</span>' : ''}
      </div>
      <div class="hero-card-name" title="${hero.nameZh} (${hero.nameEn || ''})">${hero.nameZh}</div>
    `;

    const imgEl = card.querySelector('.hero-card-img');
    if (imgEl) {
      imgEl.onerror = () => {
        imgEl.src = fallbackSvg;
        imgEl.onerror = null;
      };
    }

    // Single click: select and preview in bottom dock
    card.addEventListener('click', () => {
      elements.heroesGrid.querySelectorAll('.hero-card').forEach((c) => c.classList.remove('active-selection'));
      card.classList.add('active-selection');
      updateSelectionDock(hero);
    });

    // Double click: immediately equip & close
    card.addEventListener('dblclick', async () => {
      await equipSelectedHero(hero);
      closeHeroModal();
    });

    elements.heroesGrid.appendChild(card);
  });
}

/**
 * Show Deep Hero Tactical Showcase (View 2)
 */
function showHeroDetail(hero) {
  if (!hero) return;
  state.selectedDetailHero = hero;

  // Free-Chat Companion pseudo-hero ('companion', see FREE_CHAT_HERO_ID in
  // cloudVoiceEngine.js) has no DOTA hero data — hide the attribute/complexity
  // badges, base stats, and the tactics/abilities sections instead of
  // rendering placeholder hero jargon.
  const isFreeChat = hero.id === 'companion';

  const attrLabels = { str: '力量', agi: '敏捷', int: '智力', all: '全能', uni: '全能' };
  const attrKey = (hero.attribute === 'all' || hero.attribute === 'uni') ? 'uni' : (hero.attribute || 'str');
  const attrText = attrLabels[attrKey] || '力量';

  const complexityLabels = {
    1: '★☆☆ 入门 (简单)',
    2: '★★☆ 进阶 (中等)',
    3: '★★★ 绝活大师 (复杂)',
  };

  const fallbackSvg = generateFallbackAvatarSvg(hero.nameZh, hero.attribute);
  const avatarSrc = hero.sprites?.idle || hero.photoUrl || fallbackSvg;

  // Banner Header
  elements.detailHeroAvatar.src = avatarSrc;
  elements.detailHeroAvatar.onerror = () => {
    elements.detailHeroAvatar.src = fallbackSvg;
    elements.detailHeroAvatar.onerror = null;
  };
  elements.detailHeroName.textContent = hero.nameZh;
  elements.detailHeroAttr.textContent = attrText;
  elements.detailHeroAttr.className = `detail-attr-badge badge-${attrKey}${isFreeChat ? ' hidden' : ''}`;
  elements.detailHeroComplexity.textContent = complexityLabels[hero.complexity || 1] || '★☆☆';
  elements.detailHeroComplexity.classList.toggle('hidden', isFreeChat);
  elements.detailHeroEn.textContent = isFreeChat
    ? (hero.nameEn || '自由对话')
    : `${hero.nameEn} · ${hero.attackType === 'Ranged' ? '🏹 远程' : '⚔️ 近战'}`;

  // Base Stats
  const stats = hero.stats || {};
  elements.statStr.textContent = stats.str ? `${stats.str}+${stats.strGain || 0}` : '22+2.6';
  elements.statAgi.textContent = stats.agi ? `${stats.agi}+${stats.agiGain || 0}` : '20+2.2';
  elements.statInt.textContent = stats.int ? `${stats.int}+${stats.intGain || 0}` : '18+1.8';
  elements.statMs.textContent = stats.ms || 300;
  elements.statArmor.textContent = stats.armor !== undefined ? Number(stats.armor).toFixed(1) : '3.0';
  elements.statRange.textContent = stats.range || (hero.attackType === 'Ranged' ? '600' : '150');
  elements.detailStatsBar?.classList.toggle('hidden', isFreeChat);

  // Hype Quote (战术精粹)
  elements.detailHypeBox.textContent =
    hero.hype || `${hero.nameZh} 是《DOTA 2》中极具辨识度的英雄，掌握其出装节奏与技能连招将主宰对局胜负！`;
  elements.detailHypeBox.classList.toggle('hidden', isFreeChat);
  elements.detailHypeTitle?.classList.toggle('hidden', isFreeChat);

  // Abilities List
  elements.detailAbilitiesList.innerHTML = '';
  elements.detailAbilitiesList.classList.toggle('hidden', isFreeChat);
  elements.detailAbilitiesTitle?.classList.toggle('hidden', isFreeChat);
  const abilities = hero.abilities || [];
  if (abilities.length > 0) {
    abilities.forEach((ability) => {
      const card = document.createElement('div');
      card.className = 'ability-card';

      let upgradeHtml = '';
      if (ability.hasScepter && ability.scepterDesc) {
        upgradeHtml += `<div class="ability-upgrade-box ability-scepter">🔷 <b>阿哈利姆神杖 (A杖)</b>: ${ability.scepterDesc}</div>`;
      }
      if (ability.hasShard && ability.shardDesc) {
        upgradeHtml += `<div class="ability-upgrade-box ability-shard">🔮 <b>阿哈利姆魔晶</b>: ${ability.shardDesc}</div>`;
      }

      card.innerHTML = `
        <div class="ability-header">
          <div class="ability-name">${ability.nameZh || '招牌技能'} <span style="font-size:10px;color:#a3947a;">(${ability.nameEn || ''})</span></div>
          <div class="ability-meta-pills">
            ${ability.cooldown ? `<span class="ability-pill-cd">⏳ ${ability.cooldown}s</span>` : ''}
            ${ability.manaCost ? `<span class="ability-pill-mana">💧 ${ability.manaCost}</span>` : ''}
          </div>
        </div>
        <div class="ability-desc">${ability.desc || '造成强力战术效果。'}</div>
        ${upgradeHtml}
      `;
      elements.detailAbilitiesList.appendChild(card);
    });
  } else {
    elements.detailAbilitiesList.innerHTML = '<div style="color:#a3947a;font-size:11px;padding:8px;">暂无技能详细条目</div>';
  }

  // Catchphrases Voice Persona Preview
  if (elements.detailCatchphrasesTitle) {
    elements.detailCatchphrasesTitle.textContent = isFreeChat
      ? '🎙️ 伴侣开场白与口头禅试听'
      : '🎙️ 英雄人设台词与口头禅试听';
  }
  elements.detailCatchphrasesList.innerHTML = '';
  const catchphrases = hero.catchphrases || [`${hero.nameZh}在此，听我号令！`];
  catchphrases.forEach((phrase) => {
    const item = document.createElement('div');
    item.className = 'catchphrase-item';
    item.innerHTML = `
      <span class="catchphrase-text">"${phrase}"</span>
      <button class="btn-play-voice interactive" title="试听英雄原声">🔊 试听</button>
    `;
    const btnPlay = item.querySelector('.btn-play-voice');
    btnPlay.addEventListener('click', (e) => {
      e.stopPropagation();
      playHeroVoicelinePreview(phrase, hero);
    });
    elements.detailCatchphrasesList.appendChild(item);
  });

  updateDetailEquipButton(hero);

  // Switch modal view to Detail
  switchModalTab('detail');
}

/**
 * Play Hero Voice Line Preview with Audio Waveform Pulse
 */
function playHeroVoicelinePreview(text, hero) {
  if (!text) return;

  setAppState('speaking', `${hero.nameZh} 试听中...`);
  showToast(`🔊 播放 "${hero.nameZh}" 原声台词`);

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.0;
    utterance.pitch = hero.attribute === 'str' ? 0.85 : hero.attribute === 'agi' ? 1.05 : 0.95;
    utterance.onend = () => {
      setAppState('idle');
    };
    utterance.onerror = () => {
      setAppState('idle');
    };
    window.speechSynthesis.speak(utterance);
  } else {
    setTimeout(() => {
      setAppState('idle');
    }, 2000);
  }
}

/** Show the appearance of whoever is currently on stage. */
function updateWardrobeView() {
  const pet = state.isPetMode ? petStateMachine.getCurrentPet() : null;
  const name = pet?.displayName || state.currentHero?.nameZh || '伙伴';
  const key = pet ? 'pet:' + pet.name : 'hero:' + state.currentHero?.id;
  const profile = customizationData?.profiles[key];
  const asset = customizationData?.assets.find(item => item.id === profile?.appearance?.assetId);
  if (elements.wardrobeHeroName) elements.wardrobeHeroName.textContent = name;
  if (elements.wardrobeSkinName) elements.wardrobeSkinName.textContent = asset?.name || '内置形象';
  if (elements.wardrobeAvatarPreview) elements.wardrobeAvatarPreview.src = elements.petAvatar.src;
}

/**
 * Hero Picker Modal Logic
 */
function openHeroModal(tab = 'heroes') {
  if (!state.heroesConfig?.heroes) return;

  switchModalTab(tab);
  elements.heroModal.classList.remove('hidden');
  window.electronAPI?.setIgnoreMouseEvents(false);
}

function closeHeroModal() {
  if (elements.heroModal) {
    elements.heroModal.classList.add('hidden');
  }
}

function switchModalTab(tab) {
  state.activeModalTab = tab;

  // Reset all tabs
  elements.tabHeroList?.classList.remove('active');
  elements.tabHeroDetail?.classList.remove('active');
  elements.tabWardrobe?.classList.remove('active');
  elements.tabPetMatrix?.classList.remove('active');

  elements.viewHeroesList?.classList.add('hidden');
  elements.viewHeroDetail?.classList.add('hidden');
  elements.viewWardrobe?.classList.add('hidden');
  elements.viewPetMatrix?.classList.add('hidden');

  if (tab === 'pet-matrix') {
    elements.tabPetMatrix?.classList.add('active');
    elements.viewPetMatrix?.classList.remove('hidden');
    renderPetMatrixModalView();
  } else if (tab === 'heroes') {
    elements.tabHeroList?.classList.add('active');
    elements.viewHeroesList?.classList.remove('hidden');
    renderHeroesGrid();
  } else if (tab === 'detail') {
    elements.tabHeroDetail?.classList.add('active');
    elements.viewHeroDetail?.classList.remove('hidden');
  } else if (tab === 'wardrobe') {
    elements.tabWardrobe?.classList.add('active');
    elements.viewWardrobe?.classList.remove('hidden');
    updateWardrobeView();
  }
}

/**
 * Setup Event Listeners & IPC Bindings
 */
function setupEventListeners() {
  // Push-To-Talk Button
  elements.btnPttMic?.addEventListener('click', () => {
    toggleMicrophone();
  });

  // Translate Clipboard Button (Alt+T / F8)
  elements.btnTranslateClip?.addEventListener('click', async () => {
    if (window.electronAPI) {
      setAppState('thinking', '正在翻译...');
      const result = await window.electronAPI.translateClipboard();
      setAppState('idle');
      if (result && !result.error) {
        displayTranslationHUD(result);
      }
    }
  });

  // Modal Open & Navigation (Clicking top badge opens full 127 hero gallery)
  elements.btnHeroMenu?.addEventListener('click', () => openHeroModal('heroes'));
  elements.heroBadge?.addEventListener('click', () => {
    openHeroModal('heroes');
  });
  elements.btnCloseModal?.addEventListener('click', () => {
    closeHeroModal();
  });

  // Global Escape and Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeHeroModal();
      closePetContextMenu();
      closeSnapPopover();
      closePetMatrixPopover();
    }
    // Alt+E: Trigger Pet Signature Skill
    if ((e.altKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      if (!state.isPetMode) togglePetMode(true);
      petStateMachine.triggerSpecialSkill();
    }
    // Alt+P: Toggle Pet Mode
    if ((e.altKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      togglePetMode();
    }
  });

  elements.tabPetMatrix?.addEventListener('click', () => switchModalTab('pet-matrix'));
  elements.tabHeroList?.addEventListener('click', () => switchModalTab('heroes'));
  elements.tabHeroDetail?.addEventListener('click', () => {
    if (state.selectedDetailHero) {
      showHeroDetail(state.selectedDetailHero);
    } else if (state.currentHero) {
      showHeroDetail(state.currentHero);
    } else {
      switchModalTab('heroes');
    }
  });
  elements.tabWardrobe?.addEventListener('click', () => switchModalTab('wardrobe'));

  // Search input listeners
  elements.heroSearchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    if (state.searchQuery) {
      elements.btnClearSearch.classList.remove('hidden');
    } else {
      elements.btnClearSearch.classList.add('hidden');
    }
    renderHeroesGrid();
  });

  elements.btnClearSearch.addEventListener('click', () => {
    state.searchQuery = '';
    elements.heroSearchInput.value = '';
    elements.btnClearSearch.classList.add('hidden');
    renderHeroesGrid();
  });

  // Attribute filter pills
  elements.attrFilterTabs.querySelectorAll('.attr-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      elements.attrFilterTabs.querySelectorAll('.attr-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      state.selectedAttrFilter = pill.getAttribute('data-attr');
      renderHeroesGrid();
    });
  });

  // Secondary Complexity & Attack Filters
  elements.selectComplexityFilter?.addEventListener('change', (e) => {
    state.selectedComplexityFilter = e.target.value;
    renderHeroesGrid();
  });

  elements.selectAttackFilter?.addEventListener('change', (e) => {
    state.selectedAttackFilter = e.target.value;
    renderHeroesGrid();
  });

  // Selection Dock Action Buttons
  elements.dockBtnEquip?.addEventListener('click', async () => {
    const heroToEquip = state.selectedGalleryHero || state.currentHero;
    if (heroToEquip) {
      await equipSelectedHero(heroToEquip);
      closeHeroModal();
    }
  });

  elements.dockBtnDetail?.addEventListener('click', () => {
    const heroToDetail = state.selectedGalleryHero || state.currentHero;
    if (heroToDetail) {
      showHeroDetail(heroToDetail);
      switchModalTab('detail');
    }
  });

  // Detail View Action Buttons
  elements.btnEquipHero?.addEventListener('click', async () => {
    const heroToEquip = state.selectedDetailHero || state.currentHero;
    if (heroToEquip) {
      await equipSelectedHero(heroToEquip);
      closeHeroModal();
    }
  });

  elements.btnVoiceHero?.addEventListener('click', async () => {
    const heroToEquip = state.selectedDetailHero || state.currentHero;
    if (heroToEquip) {
      await equipSelectedHero(heroToEquip);
      closeHeroModal();
    }
    toggleMicrophone();
  });

  elements.btnBackToGallery?.addEventListener('click', () => {
    switchModalTab('heroes');
  });

  // Bubble Close & Copy
  elements.btnCloseBubble.addEventListener('click', () => {
    hideDialogueHUD();
  });

  elements.btnCopyMeaning.addEventListener('click', () => {
    copyText(elements.hudMeaning.textContent);
  });

  // Real-time Transcript Panel Controls
  elements.btnTranscript?.addEventListener('click', () => {
    if (!elements.transcriptPanel) return;
    elements.transcriptPanel.classList.toggle('hidden');
  });

  elements.btnCloseTranscript?.addEventListener('click', () => {
    elements.transcriptPanel?.classList.add('hidden');
  });

  elements.btnClearTranscript?.addEventListener('click', () => {
    if (elements.transcriptList) {
      elements.transcriptList.querySelectorAll('.transcript-msg').forEach((el) => el.remove());
    }
    if (elements.transcriptEmpty) {
      elements.transcriptEmpty.classList.remove('hidden');
    }
    transcriptStickToBottom = true;
    updateTranscriptJumpPill();
    resetTranscriptStreamRefs();
    showToast('🧹 对话记录已清空');
  });

  // History browsing: disengage stick-to-bottom as soon as the user scrolls
  // away from the latest lines, re-engage when they come back near the bottom.
  elements.transcriptList?.addEventListener('scroll', () => {
    transcriptStickToBottom = isTranscriptAtBottom();
    updateTranscriptJumpPill();
  }, { passive: true });

  elements.transcriptJumpPill?.addEventListener('click', () => {
    transcriptStickToBottom = true;
    updateTranscriptJumpPill();
    scrollTranscriptToBottom();
  });

  elements.btnCopyTranscript?.addEventListener('click', () => {
    const lines = [];
    elements.transcriptList?.querySelectorAll('.transcript-msg').forEach((msg) => {
      const role = msg.querySelector('.msg-role')?.textContent || '';
      const text = msg.querySelector('.msg-text')?.textContent || '';
      if (text) lines.push(`${role}: ${text}`);
    });
    if (lines.length > 0) {
      copyText(lines.join('\n'));
    } else {
      showToast('还没有可复制的对话');
    }
  });

  // Window Pin (lock position) Toggle
  elements.btnPin?.addEventListener('click', () => {
    window.electronAPI?.setWindowPinned?.(!state.isWindowPinned);
  });

  // Window Scale / Compact Mode Toggle
  elements.btnScale?.addEventListener('click', () => {
    window.electronAPI?.cycleScaleMode?.();
  });

  window.electronAPI?.getWindowPinned?.()
    .then((pinned) => applyWindowPinState(pinned, false))
    .catch(() => {});

  window.electronAPI?.onWindowPinnedChanged?.((data) => {
    applyWindowPinState(Boolean(data?.pinned), true);
    if (data?.rejected === 'roam') {
      showToast('📌 位置已固定，按 Alt+L 或点击 🔓 解锁后再漫游');
    }
  });

  // Window Minimize / Close
  elements.btnMinimize.addEventListener('click', () => {
    if (window.electronAPI) window.electronAPI.minimizeWindow();
  });

  elements.btnClose.addEventListener('click', () => {
    if (window.electronAPI) window.electronAPI.closeWindow();
  });

  // Snap Button & Popover
  if (elements.btnSnap && elements.snapPopover) {
    elements.btnSnap.addEventListener('click', (e) => {
      toggleSnapPopover(e);
    });

    elements.snapPopover.querySelectorAll('.snap-opt-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pos = btn.getAttribute('data-snap');
        if (pos) {
          snapToPosition(pos);
        }
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#snap-popover') && !e.target.closest('#btn-snap')) {
        closeSnapPopover();
      }
      if (!e.target.closest('#pet-matrix-popover') && !e.target.closest('#btn-tool-matrix')) {
        closePetMatrixPopover();
      }
      if (!e.target.closest('#pet-context-menu') && !e.target.closest('#pet-container')) {
        closePetContextMenu();
      }
    });
  }

  // Roam Button
  if (elements.btnRoam) {
    elements.btnRoam.addEventListener('click', () => {
      toggleRoam();
    });
  }

  // Pet Quick Matrix Popover Toggle
  elements.btnToolMatrix?.addEventListener('click', (e) => {
    togglePetMatrixPopover(e);
  });

  // Gold ripple on every quick-tool click so the press visibly registers
  elements.petQuickTools?.addEventListener('click', (e) => {
    const btn = e.target.closest('.dock-mini-btn');
    if (!btn) return;
    btn.classList.remove('tool-fired');
    void btn.offsetWidth; // restart the animation on rapid re-clicks
    btn.classList.add('tool-fired');
    setTimeout(() => btn.classList.remove('tool-fired'), 650);
  });

  document.querySelectorAll('.pet-card-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pet = btn.getAttribute('data-pet');
      if (pet) switchPet(pet);
    });
  });

  document.querySelectorAll('.ctx-pet-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const pet = chip.getAttribute('data-pet');
      if (pet) switchPet(pet);
    });
  });

  // Pet Right-Click Context Menu & Double Click
  if (elements.petContainer && elements.petContextMenu) {
    elements.petContainer.addEventListener('contextmenu', (e) => {
      openPetContextMenu(e);
    });

    elements.petContainer.addEventListener('dblclick', () => {
      handlePetDoubleClick();
    });

    // Pet Mode & Interactive Feedings & Special Skill
    elements.btnPetToggle?.addEventListener('click', () => {
      togglePetMode();
    });

    elements.ctxBtnPetMode?.addEventListener('click', () => {
      closePetContextMenu();
      togglePetMode();
    });

    elements.btnToolSpecial?.addEventListener('click', () => {
      if (!state.isPetMode) togglePetMode(true);
      petStateMachine.triggerSpecialSkill();
    });
    elements.ctxBtnPetSpecial?.addEventListener('click', () => {
      closePetContextMenu();
      if (!state.isPetMode) togglePetMode(true);
      petStateMachine.triggerSpecialSkill();
    });

    elements.btnToolTango?.addEventListener('click', () => {
      if (!state.isPetMode) togglePetMode(true);
      petStateMachine.feedItem('tango');
    });
    elements.ctxBtnPetFeedTango?.addEventListener('click', () => {
      closePetContextMenu();
      if (!state.isPetMode) togglePetMode(true);
      petStateMachine.feedItem('tango');
    });

    elements.btnToolSalve?.addEventListener('click', () => {
      if (!state.isPetMode) togglePetMode(true);
      petStateMachine.feedItem('salve');
    });
    elements.ctxBtnPetFeedSalve?.addEventListener('click', () => {
      closePetContextMenu();
      if (!state.isPetMode) togglePetMode(true);
      petStateMachine.feedItem('salve');
    });

    elements.btnToolRapier?.addEventListener('click', () => {
      if (!state.isPetMode) togglePetMode(true);
      petStateMachine.feedItem('rapier');
    });
    elements.ctxBtnPetFeedRapier?.addEventListener('click', () => {
      closePetContextMenu();
      if (!state.isPetMode) togglePetMode(true);
      petStateMachine.feedItem('rapier');
    });

    elements.btnToolSnowball?.addEventListener('click', () => {
      if (!state.isPetMode) togglePetMode(true);
      petStateMachine.throwSnowball();
    });
    elements.ctxBtnPetSnowball?.addEventListener('click', () => {
      closePetContextMenu();
      if (!state.isPetMode) togglePetMode(true);
      petStateMachine.throwSnowball();
    });

    elements.ctxBtnVoice?.addEventListener('click', () => {
      closePetContextMenu();
      toggleMicrophone();
    });

    elements.ctxBtnTranslate?.addEventListener('click', async () => {
      closePetContextMenu();
      if (window.electronAPI) {
        setAppState('thinking', '正在翻译...');
        const result = await window.electronAPI.translateClipboard();
        setAppState('idle');
        if (result && !result.error) displayTranslationHUD(result);
      }
    });

    elements.ctxBtnPin?.addEventListener('click', () => {
      closePetContextMenu();
      window.electronAPI?.setWindowPinned?.(!state.isWindowPinned);
    });

    elements.ctxBtnScale?.addEventListener('click', () => {
      closePetContextMenu();
      window.electronAPI?.cycleScaleMode?.();
    });

    elements.ctxBtnProvider?.addEventListener('click', () => {
      closePetContextMenu();
      window.electronAPI?.cycleVoiceProvider?.();
    });

    elements.ctxBtnWardrobe?.addEventListener('click', () => {
      closePetContextMenu();
      window.electronAPI?.openCustomization?.().then(result => { if (result && !result.ok) showToast(result.error); });
    });

    elements.ctxBtnPhrases?.addEventListener('click', () => {
      closePetContextMenu();
      window.electronAPI?.togglePhrasesWindow?.();
    });

    elements.ctxBtnHeroes?.addEventListener('click', () => {
      closePetContextMenu();
      openHeroModal(state.isPetMode ? 'pet-matrix' : 'heroes');
    });

    elements.ctxBtnSnapBr?.addEventListener('click', () => {
      closePetContextMenu();
      snapToPosition('bottom-right');
    });

    elements.ctxBtnSnapBl?.addEventListener('click', () => {
      closePetContextMenu();
      snapToPosition('bottom-left');
    });

    elements.ctxBtnCenter?.addEventListener('click', () => {
      closePetContextMenu();
      if (window.electronAPI) {
        window.electronAPI.centerWindow();
        showToast('📍 已重置居中');
      }
    });

    elements.ctxBtnHide?.addEventListener('click', () => {
      closePetContextMenu();
      window.electronAPI?.minimizeWindow?.();
    });

    elements.ctxBtnQuit?.addEventListener('click', () => {
      window.electronAPI?.closeWindow?.();
    });
  }

  // Setup Custom Skin Importer
  document.getElementById('btn-open-customization')?.addEventListener('click', () => {
    window.electronAPI?.openCustomization?.().then(result => { if (result && !result.ok) showToast(result.error); });
  });

  // IPC Event Bindings
  if (window.electronAPI) {
    // Initial Scale Mode Sync
    window.electronAPI.getScaleMode?.()
      .then((data) => {
        if (data?.scaleMode) applyScaleMode(data.scaleMode, data.label, false);
      })
      .catch(() => {});

    window.electronAPI.onScaleChanged?.((data) => {
      applyScaleMode(data?.scaleMode, data?.label, true);
    });

    window.electronAPI.onVoiceProviderCycled?.((data) => {
      const providerLabelEl = document.getElementById('ctx-provider-label');
      if (providerLabelEl && data?.label) {
        providerLabelEl.textContent = data.label.split(' ')[0];
      }
      showToast(`🎙️ 已切换语音引擎: ${data?.label || ''}`);
    });

    window.electronAPI.onShortcutTogglePin?.(() => {
      window.electronAPI?.setWindowPinned?.(!state.isWindowPinned);
    });

    window.electronAPI.onShortcutCycleVoiceProvider?.(() => {
      window.electronAPI?.cycleVoiceProvider?.();
    });

    window.electronAPI.onShortcutToggleCompact?.(() => {
      window.electronAPI?.cycleScaleMode?.();
    });

    window.electronAPI.onShortcutToggleVoice(() => {
      toggleMicrophone();
    });

    window.electronAPI.onPhraseSent?.((data) => {
      showToast(`🚀 [${data.label}] Row ${data.digit || ''}: "${data.text}" 已复制`);
      displayTranslationHUD({
        original: `${data.label} (热键已发送)`,
        meaningZh: `"${data.text}"`,
        intent: 'strategy',
        suggestions: ['push now', 'group up', 'well played'],
      });
    });

    window.electronAPI.onVoiceStatus?.((statusData) => {
      const providerLabelEl = document.getElementById('ctx-provider-label');
      if (statusData?.provider && providerLabelEl) {
        providerLabelEl.textContent = statusData.provider.split(' ')[0];
      }
      // Mirror the engine's real session liveness — the mic gate trusts this
      // instead of guessing from UI state.
      state.voiceConnected = statusData?.status === 'connected';
      if (!state.voiceConnected && (state.isMicActive || state.isMicStarting)) stopMicrophone();
      if (statusData?.status === 'error') {
        setAppState('idle', '连接失败 · 打开 AI 设置');
        displayTranslationHUD({ original: '请先设置语音服务', meaningZh: statusData.error, intent: 'info', suggestions: [] });
      }
    });

    window.electronAPI.onShortcutToggleRoam?.(() => {
      toggleRoam();
    });

    window.electronAPI.onShortcutTogglePetMode?.(() => {
      togglePetMode();
    });

    window.electronAPI.onShortcutTriggerPetSpecial?.(() => {
      if (!state.isPetMode) togglePetMode(true);
      petStateMachine.triggerSpecialSkill();
    });

    window.electronAPI.onRoamStateChanged?.((data) => {
      updateRoamUIState(data);
    });

    window.electronAPI.onRoamPlan?.((plan) => {
      roamMotor.applyPlan(plan);
    });

    window.electronAPI.onRoamFreeze?.((data) => {
      roamMotor.setFrozen(data?.frozen);
    });

    window.electronAPI.onRoamIdleTriggered?.(() => {
      handleRoamIdleTrigger();
    });

    window.electronAPI.onShortcutToggleHeroMenu(() => {
      if (elements.heroModal.classList.contains('hidden')) {
        openHeroModal('heroes');
      } else {
        elements.heroModal.classList.add('hidden');
      }
    });

    window.electronAPI.onVoiceTextDelta((data) => {
      setAppState('speaking', 'AI回复中...');
      state.activeSpeechText = data?.fullText || (state.activeSpeechText + (data?.delta || ''));
      showTranscriptPanel();
      if (!transcriptAgentEl) {
        transcriptAgentEl = newTranscriptMessage(getActiveCompanionName(), 'msg-agent');
        transcriptAgentEl?.classList.add('is-streaming');
      }
      setTranscriptText(transcriptAgentEl, state.activeSpeechText);
    });

    let hasReceivedPcmAudio = false;

    window.electronAPI.onVoiceAudioStart?.((data) => {
      hasReceivedPcmAudio = true;
      setAppState('speaking', 'AI讲解中...');
    });

    window.electronAPI.onVoiceInterrupted?.((data) => {
      audioPlayer.reset();
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      hasReceivedPcmAudio = false;
      state.activeSpeechText = '';
      setAppState('listening', '正在聆听...');
      if (transcriptAgentEl) {
        transcriptAgentEl.classList.remove('is-streaming');
        transcriptAgentEl.classList.add('is-interrupted');
        transcriptAgentEl = null;
      }
      // Strip the grey "still recognizing" style before dropping the ref, or a
      // barged-in interim line stays frozen in interim styling forever.
      transcriptUserEl?.classList.remove('is-interim');
      transcriptUserEl = null;
    });

    window.electronAPI.onVoiceAudioChunk((data) => {
      hasReceivedPcmAudio = true;
      setAppState('speaking', 'AI讲解中...');
      if (data?.buffer || data?.audioBase64) {
        audioPlayer.playPcmChunk(data.buffer || data.audioBase64, data.sampleRate || 24000);
      }
    });

    window.electronAPI.onUserInterim((text) => {
      if (!text) return;
      setAppState('listening', '正在识别...');
      showTranscriptPanel();
      if (!transcriptUserEl) {
        transcriptUserEl = newTranscriptMessage('召唤师', 'msg-user');
        transcriptUserEl?.classList.add('is-interim');
      }
      setTranscriptText(transcriptUserEl, text);
    });

    window.electronAPI.onUserFinal((text) => {
      if (!text) return;
      hasReceivedPcmAudio = false;
      showTranscriptPanel();
      if (!transcriptUserEl) {
        transcriptUserEl = newTranscriptMessage('召唤师', 'msg-user');
      }
      transcriptUserEl?.classList.remove('is-interim');
      setTranscriptText(transcriptUserEl, text);
      transcriptUserEl = null;
      // A prior reply whose stream died silently (WS drop, no complete/
      // interrupted) keeps blinking its ▍ cursor forever unless disarmed here.
      transcriptAgentEl?.classList.remove('is-streaming');
      transcriptAgentEl = null;
      state.activeSpeechText = '';
      setAppState('thinking', '思考回答中...');
    });

    window.electronAPI.onVoiceComplete((data) => {
      setAppState('idle');
      const textToSpeak = state.activeSpeechText || data?.text || '';
      // The engine declares whether THIS completed reply actually delivered
      // audio (hadAudio). The renderer-local flag is only a fallback for
      // payloads without the field: a user-final carrying the mic's echo of
      // the AI's own voice lands between the last audio chunk and the
      // completion and used to flip the flag, so the Windows TTS voice
      // re-read a reply the cloud TTS had just finished speaking.
      const replyHadAudio = (data && typeof data.hadAudio === 'boolean')
        ? data.hadAudio
        : hasReceivedPcmAudio;
      // Live Translate replies are spoken by the cloud in the speaker's own
      // voice — the model is audio-out by design. The local Windows TTS must
      // never voice them (user ask: 翻译模式去掉本机TTS): even a degraded
      // text-only translate turn stays silent locally instead of being
      // re-read by the robotic fallback.
      const localTtsAllowed = data?.mode !== 'live_translate';
      if (localTtsAllowed && !replyHadAudio && textToSpeak && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(textToSpeak);
        utter.lang = 'zh-CN';
        utter.rate = 1.05;
        const attr = state.currentHero?.attribute;
        utter.pitch = attr === 'str' ? 0.85 : attr === 'agi' ? 1.05 : 0.95;
        window.speechSynthesis.speak(utter);
      }
      hasReceivedPcmAudio = false;
      state.activeSpeechText = '';
      transcriptAgentEl?.classList.remove('is-streaming');
      transcriptAgentEl = null;
      transcriptUserEl = null;
    });

    window.electronAPI.onTranslateResult((data) => {
      displayTranslationHUD(data);
    });

    window.electronAPI.onHeroChanged((hero) => {
      applyHeroSkin(hero);
    });

    // ==========================================
    // DOTA 2 Game State Integration (GSI) Events
    // ==========================================
    if (elements.gsiBadge) {
      elements.gsiBadge.addEventListener('click', async () => {
        const check = await window.electronAPI.checkGsiInstall?.();
        if (check?.installed) {
          showToast(`🎮 GSI 配置文件已就绪: ${check.path}`);
        } else {
          const res = await window.electronAPI.installGsiConfig?.();
          if (res?.success) {
            showToast('✅ GSI 配置文件已自动写入 DOTA 2！');
          } else {
            showToast(`⚠️ ${res?.error || '配置安装失败'}`);
          }
        }
      });
    }

    if (elements.ctxBtnInstallGsi) {
      elements.ctxBtnInstallGsi.addEventListener('click', async () => {
        closePetContextMenu();
        const res = await window.electronAPI.installGsiConfig?.();
        if (res?.success) {
          showToast('✅ GSI 配置文件已成功安装！');
        } else {
          showToast(`⚠️ ${res?.error || '配置安装失败'}`);
        }
      });
    }

    window.electronAPI.onGsiConnectionStatus?.((data) => {
      const isLive = Boolean(data?.isConnected);
      if (elements.gsiBadge) {
        elements.gsiBadge.classList.toggle('gsi-live', isLive);
      }
      if (elements.gsiLabel) {
        elements.gsiLabel.textContent = isLive ? 'GSI 对局中' : 'GSI 待机';
      }
      if (elements.ctxGsiLabel) {
        elements.ctxGsiLabel.textContent = isLive ? '已连接 (对局中)' : '待机中 (3008)';
      }
      if (elements.gsiHudBar) {
        elements.gsiHudBar.classList.toggle('hidden', !isLive);
      }
      if (isLive) {
        showToast('🟢 DOTA 2 游戏数据已实时同步！');
      }
    });

    window.electronAPI.onGsiHeroDetected?.((data) => {
      if (data?.heroData) {
        displayTranslationHUD({
          original: `🎮 DOTA 2 选人同步: ${data.heroData.nameZh} (${data.rawName})`,
          meaningZh: `召唤师已就绪！${data.heroData.nameZh} 随同出战，祝你大杀四方！`,
          intent: 'strategy',
          suggestions: ['gl hf', 'good luck', 'let\'s win this'],
          autoDismissMs: 4500,
        });
        showToast(`✨ 已同步对局英雄: ${data.heroData.nameZh}`);
      }
    });

    window.electronAPI.onGsiCombatKill?.((data) => {
      if (state.isPetMode) {
        petStateMachine.onKillStreak(data?.streakType || 'single');
      } else if (elements.petContainer) {
        elements.petContainer.classList.add('pet-joy-hop');
        setTimeout(() => elements.petContainer?.classList.remove('pet-joy-hop'), 800);
      }

      displayTranslationHUD({
        original: `${data.title} (${data.kills}/${data.deaths}/${data.assists})`,
        meaningZh: data.message,
        intent: data.streakType === 'rampage' ? 'urgent' : 'strategy',
        suggestions: ['ez', 'well played', 'push towers now'],
        autoDismissMs: data.streakType === 'rampage' ? 6000 : 3500,
      });

      if (data.streakType === 'rampage') {
        showToast('⚡ RAMPAGE 暴走！天下无敌！');
      }
    });

    window.electronAPI.onGsiCombatDeath?.((data) => {
      if (state.isPetMode) {
        petStateMachine.onHeroDeath();
      }

      displayTranslationHUD({
        original: `${data.title} (阵亡)`,
        meaningZh: `稳住心态，复活还有 ${data.respawnSeconds} 秒！${data.canBuyback ? '可直接买活支援！' : ''}`,
        intent: 'info',
        suggestions: ['wait for me', 'careful guys', 'don\'t fight'],
        autoDismissMs: 4500,
      });
    });

    window.electronAPI.onGsiLowHealth?.((data) => {
      if (state.isPetMode) {
        petStateMachine.onLowHealthAlert();
      }

      displayTranslationHUD({
        original: data.title,
        meaningZh: data.message,
        intent: 'urgent',
        suggestions: ['help me', 'need heals', 'b b b'],
        autoDismissMs: 3200,
      });
    });

    window.electronAPI.onGsiTacticalTimer?.((data) => {
      displayTranslationHUD({
        original: data.title,
        meaningZh: data.message,
        intent: 'strategy',
        suggestions: ['get rune', 'lotus up', 'stack camps'],
        autoDismissMs: 4000,
      });

      // Subtle TTS voice announcement for important tactical runes
      if ('speechSynthesis' in window && data.message) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(data.title);
        utter.lang = 'zh-CN';
        utter.rate = 1.1;
        window.speechSynthesis.speak(utter);
      }
    });

    window.electronAPI.onGsiSnapshot?.((snapshot) => {
      if (!snapshot) return;
      if (elements.gsiHudBar) {
        elements.gsiHudBar.classList.toggle('hidden', snapshot.gameState === 'DOTA_GAMERULES_STATE_POST_GAME');
      }
      if (elements.gsiStatClock) {
        elements.gsiStatClock.textContent = `⏱️ ${snapshot.formattedClock}`;
      }
      if (elements.gsiStatKda) {
        elements.gsiStatKda.textContent = `⚔️ ${snapshot.player?.kills}/${snapshot.player?.deaths}/${snapshot.player?.assists}`;
      }
      if (elements.gsiStatGold) {
        elements.gsiStatGold.textContent = `🪙 ${snapshot.player?.gold || 0}`;
      }
    });

    window.electronAPI.onGsiInstallResult?.((result) => {
      if (result?.success) {
        showToast('✅ GSI 配置文件安装成功！');
      } else {
        showToast(`⚠️ ${result?.error || '安装失败'}`);
      }
    });
  }
}

// Initialization
window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('ctx-btn-welcome')?.addEventListener('click', () => {
    document.getElementById('pet-context-menu')?.classList.add('hidden');
    window.electronAPI?.openWelcome?.();
  });
  for (const id of ['btn-ai-settings', 'ctx-btn-ai-settings']) {
    document.getElementById(id)?.addEventListener('click', () => {
      document.getElementById('pet-context-menu')?.classList.add('hidden');
      window.electronAPI?.openAISettings?.();
    });
  }
  setupHitTesting();
  setupWindowDragging();
  setupEventListeners();
  await loadHeroConfig();
  await petMatrixReady.catch((e) => console.warn('[App] Pet matrix init failed:', e));
  window.electronAPI?.onCustomizationChanged?.(() => loadCustomization().catch(error => showToast(error.message)));
  window.electronAPI?.onCustomizationActivate?.(async key => {
    if (key.startsWith('pet:')) switchPet(key.slice(4));
    else {
      await togglePetMode(false, { silent: true });
      const hero = await window.electronAPI.selectHero(key.slice(5));
      if (hero) applyHeroSkin(hero);
    }
  });
  await loadCustomization({ migrate: true }).catch(error => showToast(error.message));

  // Restore pet mode before announcing readiness: a summoner who went to bed
  // with the courier wakes up with the courier, and the voice persona syncs.
  let restoredPetMode = false;
  if (localStorage.getItem('voicespirit_pet_mode') === '1' && !state.isPetMode) {
    await togglePetMode(true, { silent: true });
    restoredPetMode = state.isPetMode;
  }

  console.log('[App] 刀塔宠物 · DotaPet Initialized with GSI & 127+ heroes & wardrobe support.');

  // Set clean initial idle state
  setAppState('idle', '待命');
  if (restoredPetMode) {
    showToast(`✨ ${petStateMachine.getCurrentPet()?.displayName || '萌宠'} · 已就绪`);
  } else if (state.currentHero) {
    showToast(`✨ ${state.currentHero.nameZh} · 已就绪`);
  }
});
