/** Routes Google Live through the system proxy: ws() alone ignores it. */
import net from 'net';
import { execFile } from 'child_process';
import { CLOUD_KEYS } from './constants.js';

/**
 * Parse one proxy candidate ("127.0.0.1:7890", "http://127.0.0.1:7890").
 * SOCKS URLs are refused — the tunnel below speaks HTTP CONNECT only.
 */
function parseProxyCandidate(candidate) {
  if (!candidate) return null;
  let s = String(candidate).trim();
  if (!s || /^socks[45]?:\/\//i.test(s)) return null;
  s = s.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const slashIdx = s.indexOf('/');
  if (slashIdx !== -1) s = s.slice(0, slashIdx);
  const atIdx = s.lastIndexOf('@');
  if (atIdx !== -1) s = s.slice(atIdx + 1);
  const colonIdx = s.lastIndexOf(':');
  if (colonIdx === -1) return null;
  const host = s.slice(0, colonIdx);
  const port = parseInt(s.slice(colonIdx + 1), 10);
  if (!host || !Number.isFinite(port)) return null;
  return { host, port };
}

/**
 * Resolve HTTP proxy candidates for the Google Live WebSocket, highest
 * priority first: explicit config/env → standard proxy env vars → the
 * Windows system proxy (Clash etc. writes ProxyEnable/ProxyServer there).
 * Returns [] when none is configured — direct connection is the default.
 */
export async function resolveGoogleProxyCandidates() {
  const raw = [];
  if (CLOUD_KEYS.google_proxy) raw.push(CLOUD_KEYS.google_proxy);
  if (process.env.GOOGLE_LIVE_PROXY) raw.push(process.env.GOOGLE_LIVE_PROXY);
  raw.push(process.env.HTTPS_PROXY || process.env.https_proxy);
  raw.push(process.env.ALL_PROXY || process.env.all_proxy);
  if (process.platform === 'win32') {
    try {
      const query = (args) =>
        new Promise((resolve) => {
          execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', ...args], { timeout: 4000 }, (err, stdout) => resolve(err ? '' : String(stdout || '')));
        });
      const enableOut = await query(['/v', 'ProxyEnable']);
      if (/0x1/.test(enableOut)) {
        const serverOut = await query(['/v', 'ProxyServer']);
        const m = serverOut.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
        if (m) raw.push(m[1]);
      }
    } catch (e) {
      // Registry unreadable → just skip the system-proxy candidate.
    }
  }
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const parsed = parseProxyCandidate(item);
    if (!parsed) continue;
    const key = `${parsed.host}:${parsed.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }
  return out;
}

/**
 * Open an HTTP CONNECT tunnel through *proxy* to targetHost:targetPort and
 * resolve with the raw socket (TLS is layered on it by the caller). Rejects
 * fast on refused/timeout so a dead system-proxy entry can fall back to a
 * direct connection without stalling voice connect.
 */
export function establishHttpTunnel(proxy, targetHost, targetPort, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const raw = net.connect({ host: proxy.host, port: proxy.port });
    let settled = false;
    let buf = Buffer.alloc(0);

    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { raw.destroy(); } catch (e) {}
      reject(err);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      raw.setTimeout(0);
      resolve(raw);
    };

    raw.setTimeout(timeoutMs, () => fail(new Error(`代理 ${proxy.host}:${proxy.port} 连接超时`)));
    raw.on('error', fail);
    raw.on('connect', () => {
      raw.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: keep-alive\r\n\r\n`);
    });
    raw.on('data', function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      raw.removeListener('data', onData);
      const statusLine = buf.subarray(0, buf.indexOf('\r\n')).toString('utf8').trim();
      if (!/^HTTP\/1\.[01] 200/.test(statusLine)) {
        fail(new Error(`代理 CONNECT 被拒绝: ${statusLine}`));
        return;
      }
      succeed();
    });
  });
}
