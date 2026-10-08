import { EventEmitter } from 'events';
import { normalizeGsiHeroName } from './heroMap.js';

// Minimum interval (ms) between consecutive 'snapshot' emissions.
// GSI fires at up to 10 Hz (throttle 0.1s in cfg), but the renderer only
// updates a clock / KDA / gold text display — 2 Hz (500ms) is plenty smooth.
const SNAPSHOT_THROTTLE_MS = 500;

export class GSIParser extends EventEmitter {
  constructor(options = {}) {
    super();
    this.heroesConfig = options.heroesConfig || null;
    this.autoSwitchHero = options.autoSwitchHero !== false;
    this.enableCombatAlerts = options.enableCombatAlerts !== false;
    this.enableRuneTimers = options.enableRuneTimers !== false;

    this.reset();
  }

  setHeroesConfig(config) {
    this.heroesConfig = config;
  }

  setOptions({ autoSwitchHero, enableCombatAlerts, enableRuneTimers }) {
    if (typeof autoSwitchHero === 'boolean') this.autoSwitchHero = autoSwitchHero;
    if (typeof enableCombatAlerts === 'boolean') this.enableCombatAlerts = enableCombatAlerts;
    if (typeof enableRuneTimers === 'boolean') this.enableRuneTimers = enableRuneTimers;
  }

  reset() {
    this.lastHeroRaw = null;
    this.currentHeroId = null;
    this.lastKills = 0;
    this.lastDeaths = 0;
    this.lastAssists = 0;
    this.lastStreak = 0;
    this.lastAlive = true;
    this.wasLowHealth = false;
    this.lastClockTime = -9999;
    this.lastGameState = null;
    this.matchId = null;

    // Track triggered alerts by key to prevent duplicate emissions in the same game window
    this.triggeredTimers = new Set();

    // Snapshot throttle: avoid flooding the renderer with high-frequency IPC
    this.lastSnapshotTime = 0;
  }

  /**
   * Main entry point: process incoming DOTA 2 GSI payload
   * @param {object} data Raw JSON from DOTA 2
   */
  processPayload(data) {
    if (!data || typeof data !== 'object') return null;

    const map = data.map || {};
    const player = data.player || {};
    const hero = data.hero || {};

    // 1. Match / Game State lifecycle
    const currentMatchId = map.matchid || null;
    if (currentMatchId && currentMatchId !== this.matchId) {
      console.log(`[GSI] New match detected: ${currentMatchId}`);
      this.reset();
      this.matchId = currentMatchId;
      this.emit('match_started', { matchId: currentMatchId, mapName: map.name });
    }

    const gameState = map.game_state || 'UNKNOWN';
    if (gameState !== this.lastGameState) {
      this.lastGameState = gameState;
      this.emit('game_state_changed', { gameState, clockTime: map.clock_time });
    }

    // 2. Hero Recognition & Auto-switch
    if (hero.name && hero.name !== this.lastHeroRaw) {
      this.lastHeroRaw = hero.name;
      const normalizedId = normalizeGsiHeroName(hero.name, this.heroesConfig?.heroes);
      if (normalizedId) {
        const isNew = normalizedId !== this.currentHeroId;
        this.currentHeroId = normalizedId;
        const heroData = this.heroesConfig?.heroes?.[normalizedId] || null;

        console.log(`[GSI] Hero recognized: ${hero.name} -> ${normalizedId} (${heroData?.nameZh || 'Unknown'})`);
        this.emit('hero_detected', {
          rawName: hero.name,
          heroId: normalizedId,
          heroData,
          level: hero.level || 1,
          isNew,
          autoSwitch: this.autoSwitchHero,
        });
      }
    }

    // 3. Combat Events (Kills, Deaths, Rampage, Low HP)
    if (this.enableCombatAlerts && map.game_state === 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS') {
      this.processCombatEvents(player, hero);
    }

    // 4. Tactical Clock & Rune Timers
    if (this.enableRuneTimers && typeof map.clock_time === 'number' && !map.paused) {
      this.processTacticalTimers(map.clock_time, map.game_state);
    }

    // 5. Generate and emit consolidated snapshot for UI (throttled)
    const snapshot = this.buildSnapshot(data);
    const now = Date.now();
    if (now - this.lastSnapshotTime >= SNAPSHOT_THROTTLE_MS) {
      this.lastSnapshotTime = now;
      this.emit('snapshot', snapshot);
    }
    return snapshot;
  }

  processCombatEvents(player, hero) {
    const kills = Number(player.kills) || 0;
    const deaths = Number(player.deaths) || 0;
    const assists = Number(player.assists) || 0;
    const killStreak = Number(player.kill_streak) || 0;
    const isAlive = hero.alive !== false;

    // Detect Kills
    if (kills > this.lastKills) {
      const diff = kills - this.lastKills;
      let streakType = 'single';
      let title = '击杀 +1！';
      let message = '手感火热，击杀敌方英雄！';

      if (killStreak >= 5) {
        streakType = 'rampage';
        title = '⚡ 暴走 (RAMPAGE)！';
        message = '天下无敌！连斩5人，势不可挡！';
      } else if (killStreak === 4) {
        streakType = 'ultra';
        title = '🔥 疯狂杀戮 (Ultra Kill)！';
        message = '四杀达成，全场瞩目！';
      } else if (killStreak === 3) {
        streakType = 'triple';
        title = '💥 三杀 (Triple Kill)！';
        message = '势如破竹，三连击杀！';
      } else if (killStreak === 2) {
        streakType = 'double';
        title = '⚔️ 双杀 (Double Kill)！';
        message = '漂亮！双杀入账！';
      }

      this.emit('combat_kill', {
        kills,
        deaths,
        assists,
        streak: killStreak,
        streakType,
        title,
        message,
        gold: player.gold,
      });
    }

    // Detect Death
    if (deaths > this.lastDeaths || (this.lastAlive && !isAlive)) {
      const respawnSec = Number(hero.respawn_seconds) || 0;
      const buybackCost = Number(hero.buyback_cost) || 0;
      const buybackCd = Number(hero.buyback_cooldown) || 0;
      const canBuyback = (player.gold || 0) >= buybackCost && buybackCd === 0;

      let deathMsg = `阵亡倒计时 ${respawnSec} 秒`;
      if (canBuyback) {
        deathMsg += ` (可用买活: 🪙 ${buybackCost})`;
      } else if (buybackCd > 0) {
        deathMsg += ` (买活 CD: ${buybackCd}s)`;
      }

      this.emit('combat_death', {
        deaths,
        respawnSeconds: respawnSec,
        buybackCost,
        buybackCooldown: buybackCd,
        canBuyback,
        title: '💔 英雄阵亡',
        message: deathMsg,
      });
    }

    // Low HP Panic Alert (< 25% health and alive)
    const healthPercent = Number(hero.health_percent) || 100;
    if (isAlive && healthPercent > 0 && healthPercent <= 25) {
      if (!this.wasLowHealth) {
        this.wasLowHealth = true;
        this.emit('low_health_alert', {
          health: hero.health,
          maxHealth: hero.max_health,
          healthPercent,
          title: '⚠️ 濒血警报！',
          message: `生命值仅剩 ${healthPercent}%，注意开 BKB 或吃魔棒大药！`,
        });
      }
    } else if (healthPercent > 40) {
      this.wasLowHealth = false;
    }

    this.lastKills = kills;
    this.lastDeaths = deaths;
    this.lastAssists = assists;
    this.lastStreak = killStreak;
    this.lastAlive = isAlive;
  }

  processTacticalTimers(clockTime, gameState) {
    if (gameState !== 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' && gameState !== 'DOTA_GAMERULES_STATE_PRE_GAME') {
      return;
    }

    const t = Math.floor(clockTime);

    // 1. Bounty Runes & Lotus (Every 3 mins: 3:00, 6:00, 9:00...)
    // Alert at T-15s (165, 345, 525...)
    if (t > 0 && (t + 15) % 180 === 0) {
      const nextMinute = Math.floor((t + 15) / 60);
      const key = `bounty_${nextMinute}`;
      if (!this.triggeredTimers.has(key)) {
        this.triggeredTimers.add(key);
        this.emit('tactical_timer', {
          type: 'bounty_lotus',
          targetMinute: nextMinute,
          title: '🌸 赏金神符 & 莲花池提醒',
          message: `15秒后 (${nextMinute}:00) 赏金符与莲花池刷新，速去争夺！`,
          secondsRemaining: 15,
        });
      }
    }

    // 2. Power Runes (Every 2 mins starting at 6:00: 6:00, 8:00, 10:00...)
    // Alert at T-15s (345, 465, 585...)
    if (t >= 345 && (t + 15) % 120 === 0 && (t + 15) >= 360) {
      const nextMinute = Math.floor((t + 15) / 60);
      const key = `power_${nextMinute}`;
      if (!this.triggeredTimers.has(key)) {
        this.triggeredTimers.add(key);
        this.emit('tactical_timer', {
          type: 'power_rune',
          targetMinute: nextMinute,
          title: '⚡ 河道强化神符刷新',
          message: `15秒后 (${nextMinute}:00) 河道神符刷新，注意控符！`,
          secondsRemaining: 15,
        });
      }
    }

    // 3. Wisdom Runes (Every 7 mins starting at 7:00: 7:00, 14:00, 21:00...)
    // Alert at T-30s (390, 810, 1230...)
    if (t >= 390 && (t + 30) % 420 === 0 && (t + 30) >= 420) {
      const nextMinute = Math.floor((t + 30) / 60);
      const key = `wisdom_${nextMinute}`;
      if (!this.triggeredTimers.has(key)) {
        this.triggeredTimers.add(key);
        this.emit('tactical_timer', {
          type: 'wisdom_rune',
          targetMinute: nextMinute,
          title: '📖 智慧经验符刷新',
          message: `30秒后 (${nextMinute}:00) 智慧神符刷新，全队经验至关重要！`,
          secondsRemaining: 30,
        });
      }
    }

    // 4. Tormentor (At 20:00 = 1200s, alert at 19:30 = 1170s)
    if (t >= 1170 && t <= 1200) {
      const key = 'tormentor_20';
      if (!this.triggeredTimers.has(key)) {
        this.triggeredTimers.add(key);
        this.emit('tactical_timer', {
          type: 'tormentor',
          targetMinute: 20,
          title: '⚔️ 痛苦魔方即将降临',
          message: '30秒后 (20:00) 痛苦魔方刷新，可组织队伍击杀获取魔晶！',
          secondsRemaining: 30,
        });
      }
    }

    this.lastClockTime = t;
  }

  buildSnapshot(data) {
    const map = data.map || {};
    const player = data.player || {};
    const hero = data.hero || {};
    const heroData = this.currentHeroId ? this.heroesConfig?.heroes?.[this.currentHeroId] : null;

    const clockTime = typeof map.clock_time === 'number' ? map.clock_time : 0;
    const isNegative = clockTime < 0;
    const absSec = Math.abs(Math.floor(clockTime));
    const mins = Math.floor(absSec / 60);
    const secs = absSec % 60;
    const formattedClock = `${isNegative ? '-' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;

    return {
      isConnected: true,
      matchId: map.matchid || null,
      gameState: map.game_state || 'MENU',
      clockTime,
      formattedClock,
      daytime: map.daytime !== false,
      paused: Boolean(map.paused),
      player: {
        name: player.name || 'Player',
        kills: Number(player.kills) || 0,
        deaths: Number(player.deaths) || 0,
        assists: Number(player.assists) || 0,
        killStreak: Number(player.kill_streak) || 0,
        gold: Number(player.gold) || 0,
        gpm: Number(player.gpm) || 0,
        xpm: Number(player.xpm) || 0,
        netWorth: Number(player.net_worth) || Number(player.gold) || 0,
      },
      hero: {
        rawName: hero.name || '',
        id: this.currentHeroId,
        nameZh: heroData?.nameZh || hero.name || '未选定英雄',
        level: Number(hero.level) || 1,
        alive: hero.alive !== false,
        health: Number(hero.health) || 0,
        maxHealth: Number(hero.max_health) || 0,
        healthPercent: Number(hero.health_percent) || 100,
        manaPercent: Number(hero.mana_percent) || 100,
        respawnSeconds: Number(hero.respawn_seconds) || 0,
        buybackCost: Number(hero.buyback_cost) || 0,
        buybackCooldown: Number(hero.buyback_cooldown) || 0,
      },
      timestamp: Date.now(),
    };
  }
}
