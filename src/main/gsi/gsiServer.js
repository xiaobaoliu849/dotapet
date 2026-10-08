import http from 'http';
import { EventEmitter } from 'events';
import { GSIParser } from './gsiParser.js';

export class GSIServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || 3008;
    this.host = options.host || '127.0.0.1';
    this.server = null;
    this.parser = new GSIParser({
      heroesConfig: options.heroesConfig,
      autoSwitchHero: options.autoSwitchHero !== false,
      enableCombatAlerts: options.enableCombatAlerts !== false,
      enableRuneTimers: options.enableRuneTimers !== false,
    });

    this.isConnected = false;
    this.lastPacketTime = 0;
    this.heartbeatTimer = null;
    this.timeoutThresholdMs = 25000; // 25s without packet -> offline

    this.initParserForwarding();
  }

  initParserForwarding() {
    const FORWARD_EVENTS = [
      'hero_detected',
      'combat_kill',
      'combat_death',
      'low_health_alert',
      'tactical_timer',
      'game_state_changed',
      'match_started',
      'snapshot',
    ];
    for (const eventName of FORWARD_EVENTS) {
      this.parser.on(eventName, (data) => this.emit(eventName, data));
    }
  }

  setHeroesConfig(config) {
    this.parser.setHeroesConfig(config);
  }

  setOptions(opts) {
    this.parser.setOptions(opts);
  }

  start() {
    if (this.server) return;

    this.server = http.createServer((req, res) => {
      // DOTA 2 sends POST requests with application/json
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          // Security limit: maximum 5MB body
          if (body.length > 5 * 1024 * 1024) {
            req.destroy();
          }
        });

        // A client disconnecting mid-body must not surface as an unhandled
        // 'error' on the request stream.
        req.on('error', () => {});

        req.on('end', () => {
          try {
            if (body) {
              const payload = JSON.parse(body);
              this.onPacketReceived(payload);
            }
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
          } catch (err) {
            console.warn('[GSIServer] Malformed JSON payload received:', err.message);
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid JSON');
          }
        });
      } else {
        // Health check endpoint. Browsers get a human-readable status page;
        // machines (tests, monitors) still get the plain JSON probe.
        if ((req.headers.accept || '').includes('text/html')) {
          const connected = this.isConnected;
          const stateColor = connected ? '#34d399' : '#f59e0b';
          const stateText = connected
            ? '🟢 已连接 DOTA 2 — 游戏数据实时接收中'
            : '🟡 运行中，等待 DOTA 2 推送数据（进游戏后自动连接）';
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>DOTA 2 VoiceSpirit — GSI 监听器</title>
<style>
  body { background:#0f172a; color:#e2e8f0; font-family:'Segoe UI',sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
  .card { max-width:560px; padding:40px; background:#1e293b; border:1px solid rgba(56,189,248,.3); border-radius:14px; }
  h1 { margin:0 0 8px; font-size:20px; color:#38bdf8; }
  p.state { font-size:16px; color:${stateColor}; font-weight:600; }
  p.hint { color:#94a3b8; font-size:13px; line-height:1.7; }
  code { background:#0f172a; padding:2px 6px; border-radius:4px; }
</style>
</head>
<body>
  <div class="card">
    <h1>⚡ DOTA 2 VoiceSpirit — GSI 本地监听器</h1>
    <p class="state">${stateText}</p>
    <p class="hint">这不是网页应用，而是 DOTA 2 游戏状态集成 (GSI) 的本地数据接口。<br>
    DOTA 2 客户端会把对局事件实时 POST 到 <code>http://127.0.0.1:${this.port}/</code>，由桌面宠物端消费。<br>
    此地址无需在浏览器中打开；机器探测可访问 JSON: <code>{"status","isConnected","port"}</code></p>
  </div>
</body>
</html>`);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'active', isConnected: this.isConnected, port: this.port }));
        }
      }
    });

    this.server.on('error', (err) => {
      console.error(`[GSIServer] Error on port ${this.port}:`, err.message);
      this.emit('error', err);
    });

    this.server.listen(this.port, this.host, () => {
      console.log(`[GSIServer] DOTA 2 GSI Local Listener running on http://${this.host}:${this.port}/`);
      this.startHeartbeatWatcher();
      this.emit('listening', { host: this.host, port: this.port });
    });
  }

  onPacketReceived(payload) {
    this.lastPacketTime = Date.now();

    if (!this.isConnected) {
      this.isConnected = true;
      console.log('[GSIServer] DOTA 2 GSI connection established!');
      this.emit('connection_status', { isConnected: true, message: 'DOTA 2 游戏数据已连接' });
    }

    this.parser.processPayload(payload);
  }

  startHeartbeatWatcher() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      if (this.isConnected && now - this.lastPacketTime > this.timeoutThresholdMs) {
        this.isConnected = false;
        console.log('[GSIServer] DOTA 2 GSI connection timed out (game closed or exited).');
        this.emit('connection_status', { isConnected: false, message: '等待 DOTA 2 启动对局' });
      }
    }, 5000);
  }

  stop() {
    clearInterval(this.heartbeatTimer);
    if (this.server) {
      this.server.close();
      this.server = null;
      console.log('[GSIServer] DOTA 2 GSI Server stopped.');
    }
  }
}
