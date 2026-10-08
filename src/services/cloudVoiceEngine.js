import WebSocket from 'ws';
import EventEmitter from 'events';
import crypto from 'crypto';
import net from 'net';
import tls from 'tls';
import { execFile } from 'child_process';
import {
  appendAssistantDelta,
  cleanQwenTranscriptArtifacts,
  isOutputSuppressed,
  missingTextSuffix,
  shouldLiftSuppression,
  streamingNovelty,
  stripMarkdownForTts,
} from './transcriptStream.js';


// Doubao Duplex Realtime Constants (Standardized 2026-08)
export const DEFAULT_DOUBAO_DUPLEX_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue';
export const DEFAULT_DOUBAO_DUPLEX_DIALOG_MODEL = '1.2.6.1';
export const DEFAULT_DOUBAO_REALTIME_VOICE = 'zh_female_xiaohe_jupiter_bigtts';
export const DOUBAO_REALTIME_VOICES = [
  'zh_female_xiaohe_jupiter_bigtts', // xiaohe · 甜美台腔女声 (default，移植自 VoiceSpirit)
  'zh_female_vv_jupiter_bigtts',     // vv · 活泼灵动女声
  'zh_male_yunzhou_jupiter_bigtts',  // yunzhou · 清爽沉稳男声
  'zh_male_xiaotian_jupiter_bigtts', // xiaotian · 清爽磁性男声
  'en_male_tim_uranus_bigtts',       // Tim · 美式英语
  'en_female_dacey_uranus_bigtts',   // Dacey · 美式英语
  'en_female_stokie_uranus_bigtts',  // Stokie · 美式英语
];

// Language-Aware Female Voice Mappings (Female Only for pure natural gaming coach experience)
// Doubao is intentionally absent: its en_* voices are English-only, so dynamic
// switching there breaks Chinese TTS — the voice stays pinned to xiaohe.

// Pseudo-hero id that unlocks Free-Chat Companion mode (see getHeroSystemPrompt):
// casual chatting by default, with model-side smart routing into any hero's
// persona when the summoner addresses one.
export const FREE_CHAT_HERO_ID = 'companion';
const FREE_CHAT_HERO_IDS = new Set([FREE_CHAT_HERO_ID]);

export const FEMALE_VOICES = {
  qwen: {
    zh: 'Tina',       // Tina · 阿里知性温和中文女声（中英双语）
    en: 'Jennifer',   // Jennifer · 阿里标准地道美音/英音女声（中英双语）
  },
  cartesia: {
    zh: 'f786b574-daa5-4673-aa0c-cbe3e8534c02',
    en: 'f786b574-daa5-4673-aa0c-cbe3e8534c02', // Katie · Cartesia 原生欧美高清女声
  },
};

export function detectPrimaryLanguage(text) {
  if (!text || !text.trim()) return 'zh';
  const trimmed = text.trim();
  const chineseChars = (trimmed.match(/[\u4e00-\u9fa5]/g) || []).length;
  const latinLetters = (trimmed.match(/[a-zA-Z]/g) || []).length;

  if (chineseChars === 0 && latinLetters > 0) {
    return 'en';
  }
  if (latinLetters > chineseChars * 2) {
    return 'en';
  }
  return 'zh';
}

// DashScope Qwen Realtime Constants (Synced with VoiceSpirit 2026-09)
export const DEFAULT_DASHSCOPE_REALTIME_MODEL = 'qwen3.8-omni-flash-realtime';
export const DEFAULT_DASHSCOPE_REALTIME_VOICE = 'Tina';
export const DEFAULT_QWEN_OMNI_TURN_DETECTION = {
  type: 'server_vad',
  threshold: 0.2,
  silence_duration_ms: 800,
  prefix_padding_ms: 300,
};
export const QWEN_AUDIO_BENIGN_ERROR_PATTERNS = [
  'Cannot create response while user is speaking',
  'no active response',
  'Cannot cancel',
  'already has an active response',
  'Unknown function call id',
];
export const QWEN_OMNI_38_REALTIME_VOICES = [
  'Tina', 'Cindy', 'Liora Mira', 'Raymond', 'Theo Calm',
  'Serena', 'Maia', 'Evan', 'Qiao', 'Momo', 'Wil', 'Angel',
  'Li Cassian', 'Mia', 'Joyner', 'Gold', 'Katerina', 'Ryan', 'Jennifer',
  'Aiden', 'Mione', 'Sunny', 'Dylan', 'Eric', 'Peter', 'Joseph Chen',
  'Marcus', 'Li', 'Kiki', 'Rocky', 'Sohee', 'Lenn', 'Ono Anna', 'Sonrisa',
  'Bodega', 'Emilien', 'Andre', 'Radio Gol', 'Alek', 'Rizky', 'Roya', 'Arda',
  'Hana', 'Dolce', 'Jakub', 'Griet', 'Eliška', 'Marina', 'Siiri', 'Ingrid',
  'Sigga', 'Bea', 'Chloe', 'Zane', 'Cici', 'longanlingxin',
];
export const QWEN_AUDIO_31_REALTIME_VOICES = [
  'longanqian', 'longanlingxin', 'longanlingxi', 'longanxiaoxin', 'longanlufeng',
  'longanqian_v3.1', 'longanhuan_v3.1', 'longanlingxin_v3.1', 'longanfengyue_v3.1',
  'xunanchuan_v3.1', 'beth_v3.1', 'betty_v3.1', 'cally_v3.1',
];
export const DEFAULT_QWEN_AUDIO_31_REALTIME_VOICE = 'longanqian_v3.1';

// Cartesia Constants
export const CARTESIA_VERSION = '2026-08-14';
export const DEFAULT_CARTESIA_BASE_URL = 'https://api.cartesia.ai';
export const DEFAULT_CARTESIA_VOICE = 'f786b574-daa5-4673-aa0c-cbe3e8534c02';
export const DEFAULT_CARTESIA_MODEL = 'sonic-preview';

// Google Gemini Live Constants (ported from VoiceSpirit realtime_google_provider.py +
// realtime_constants.py). Two providers share one BidiGenerateContent WebSocket:
//   provider 'google'            → 实时对话  gemini-3.1-flash-live-preview (hero persona, VAD barge-in)
//   provider 'google-translate'  → 实时翻译  gemini-3.5-live-translate-preview (translationConfig only)
export const GOOGLE_LIVE_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export const DEFAULT_GOOGLE_REALTIME_MODEL = 'gemini-3.1-flash-live-preview';
export const DEFAULT_GOOGLE_LIVE_TRANSLATE_MODEL = 'gemini-3.5-live-translate-preview';
export const DEFAULT_GOOGLE_REALTIME_VOICE = 'Puck';
export const GOOGLE_REALTIME_VOICES = [
  'Puck',    // default — upbeat male (VoiceSpirit default)
  'Charon',  // informative male
  'Kore',    // firm female
  'Fenrir',  // excitable male
  'Aoede',   // breezy female
  'Zephyr',  // bright female
];
// Live Translate turns close on 2s of downstream silence, mirroring VoiceSpirit's
// inactivity monitor (complete_live_translate_turn_if_needed force branch).
export const GOOGLE_LIVE_TRANSLATE_IDLE_MS = 2000;
// The gemini-3.x flash-live generation IGNORES server-side end-of-speech: a
// turn is only committed when the client sends realtimeInput.audioStreamEnd
// (verified live 2026-08 — without it the session never answers). Client-side
// VAD is therefore THE turn mechanism of the 'google' chat provider: track
// RMS of outgoing PCM, and after GOOGLE_CLIENT_VAD_SILENCE_MS of trailing
// silence that followed actual speech, commit the utterance. The
// live-translate provider is excluded — gemini-3.5-live-translate-preview
// commits turns server-side via transcription finished-markers.
export const GOOGLE_CLIENT_VAD_SILENCE_MS = 1100;
export const GOOGLE_CLIENT_VAD_RMS_THRESHOLD = 250;

/**
 * Cloud API Key Configuration for VoiceSpirit Real-time Duplex & Translation Providers
 */
export const CLOUD_KEYS = {
  dashscope: '',
  dashscope_ws_url: '',
  dashscope_base_url: '',
  translation_model: 'qwen-flash',
  deepseek: '',
  gemini: '',
  cartesia: '',
  cartesia_voice_id: DEFAULT_CARTESIA_VOICE,
  cartesia_model: DEFAULT_CARTESIA_MODEL,
  doubao_api_key: '',
  doubao_access_token: '',
  doubao_app_id: '',
  doubao_websearch_key: '',
  doubao_ws_url: DEFAULT_DOUBAO_DUPLEX_ENDPOINT,
  google_ws_url: '',
  google_proxy: '',
};

// Credentials are supplied by the companion's encrypted store in the main process.
// Preserve this no-op export for existing integrations; never scan another app's files.
export function loadEnv() {}
const CLOUD_DEFAULTS = Object.freeze({ ...CLOUD_KEYS });
export function configureCloudKeys(values = {}) {
  for (const key of Object.keys(CLOUD_DEFAULTS)) CLOUD_KEYS[key] = values[key] ?? CLOUD_DEFAULTS[key];
  CLOUD_KEYS.cartesia_llm_key = values.cartesia_llm_key || '';
  CLOUD_KEYS.translation_provider = values.translation_provider || 'qwen';
  CLOUD_KEYS.deepseek_model = values.deepseek_model || 'deepseek-flash';
}

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
async function resolveGoogleProxyCandidates() {
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
function establishHttpTunnel(proxy, targetHost, targetPort, timeoutMs = 6000) {
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

/**
 * Helper to generate a unique event id
 */
function generateEventId(prefix = 'evt') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Direct Cloud Real-time Duplex Voice Engine
 * Supports:
 * 1. Cartesia Ink-2 STT + DeepSeek-Flash LLM + Cartesia Sonic TTS (High-speed conversational stream)
 * 2. Volcengine Doubao SeedPulse Duplex Realtime WebSocket (Pure JSON Full-Duplex Protocol)
 * 3. DashScope Qwen-Audio / Qwen-Omni Realtime WebSocket (OpenAI Realtime Protocol)
 */
export class CloudVoiceEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.currentHero = options.currentHero || null;
    this.provider = options.provider || process.env.VOICE_PROVIDER || 'cartesia';
    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.sampleRate = 16000;
    this.voice = options.voice || 'Tina';
    this.model = options.model || DEFAULT_DOUBAO_DUPLEX_DIALOG_MODEL;
    this.doubaoVoice = options.doubaoVoice || DEFAULT_DOUBAO_REALTIME_VOICE;
    this.sessionId = null;
    this.apiKey = options.apiKey || null;
    this.autoReconnect = options.autoReconnect !== false;
    this.autoVoice = options.autoVoice !== false;
    this.googleModel = options.googleModel || null;
    this.googleTranslateModel = options.googleTranslateModel || null;
    this.suppressOutput = false;
    this.activeTurnId = null;
    this.userAcc = '';
    this.aiAcc = '';
    this.ttsActive = false;

    // Google Gemini Live state (chat + live-translate). See resetGoogleLiveState.
    this.googleVoice = options.googleVoice || DEFAULT_GOOGLE_REALTIME_VOICE;
    this.translateTargetLanguage = options.translateTargetLanguage || 'en';
    // Official default is false and false is translator semantics: with echo
    // on, input already spoken in the TARGET language is parroted back
    // verbatim ("speak English → hear your own English again"), which reads
    // exactly like the translate provider ignoring the language selection.
    this.translateEcho = options.translateEcho === true;
    this.resetGoogleLiveState();

    // Doubao duplex transcript-stream state (see docs/realtime-transcript-integrity.md):
    // suppressedResponseId scopes barge-in residue dropping to the interrupted
    // reply instead of a blanket window (a new reply's text deltas routinely
    // arrive BEFORE its own output_audio.started and a blanket window ate them).
    // activeResponseId is the Doubao-namespaced playing reply, kept strictly
    // separate from activeTurnId so a late ASR completed can never mis-anchor it.
    this.suppressedResponseId = null;
    this.activeResponseId = null;
    this.lastFinalizedResponseId = null;
    // Which response the text currently sitting in aiAcc belongs to — lets
    // output_audio.started recognise a reply whose opening text deltas beat
    // their own started event instead of wiping them as stale data.
    this.aiAccResponseId = null;
    this.turnFinalized = true;

    // Qwen realtime dual-family arbitration state: both response.text.delta and
    // response.audio_transcript.delta stream the SAME sentence when
    // modalities=[text,audio]; without arbitration the reply text duplicates.
    this.qwenFamilyState = {};
    this.qwenInterimByItem = {};
    this.resetTranscriptState();

    // Cartesia + DeepSeek pipeline state
    this.cartesiaSttWs = null;
    this.cartesiaTtsWs = null;
    this.cartesiaAbortController = null;
    this.cartesiaContextId = null;
    this.cartesiaHistory = [];
    this.cartesiaIsSttOpen = false;
    this.cartesiaIsTtsOpen = false;

    // True while a deliberate disconnect() is in flight, so the asynchronous
    // 'close' event of the dying socket cannot schedule a reconnect.
    this.suppressReconnect = false;
  }

  /**
   * Reset every per-stream transcript accumulator. Called on construction,
   * provider switch and disconnect so stale deltas from a previous session can
   * never leak into a new one.
   */
  resetTranscriptState() {
    this.suppressOutput = false;
    this.activeTurnId = null;
    this.userAcc = '';
    this.aiAcc = '';
    this.ttsActive = false;
    // Whether the reply CURRENTLY being assembled has delivered any audio.
    // Published as hadAudio on agent_complete so the renderer's local-TTS
    // fallback can trust the engine instead of guessing from event order —
    // an echo/late user-final arriving between the last audio chunk and the
    // completion used to flip the renderer's own flag and make the browser
    // voice re-read a reply that the cloud TTS had already spoken.
    this.turnHadAudio = false;
    this.suppressedResponseId = null;
    this.activeResponseId = null;
    this.lastFinalizedResponseId = null;
    this.aiAccResponseId = null;
    this.turnFinalized = true;
    this.qwenFamilyState = {};
    this.qwenInterimByItem = {};
    this.qwenSuppressedResponseIds = new Set();
    this.resetGoogleLiveState();
  }

  /**
   * Reset every Google Gemini Live per-session accumulator. Google's
   * input/output transcription frames are cumulative-shaped with overlapping
   * revisions (same as DashScope LiveTranslate), so both sides merge through
   * streamingNovelty — a stale accumulator would glue old words onto a new
   * turn. The translate idle monitor owns its own interval and must survive
   * turn finalization, hence it is torn down only here / on disconnect.
   */
  resetGoogleLiveState() {
    this.googleUserAcc = '';
    this.googleAiAcc = '';
    this.googleUserAccHasContent = false;
    this.googleTranslateInputFinished = false;
    this.googleTranslateOutputFinished = false;
    this.googleTranslateHasContent = false;
    this.googleLastActivityMs = 0;
    this.googleAudioStarted = false;
    this.googleSuppress = false;
    this.googleSawSpeech = false;
    this.googleSilenceMs = 0;
    this.stopGoogleTranslateMonitor();
  }

  startGoogleTranslateMonitor() {
    this.stopGoogleTranslateMonitor();
    this.googleTranslateMonitor = setInterval(() => {
      if (
        this.provider === 'google-translate' &&
        this.googleTranslateHasContent &&
        this.googleLastActivityMs &&
        Date.now() - this.googleLastActivityMs >= GOOGLE_LIVE_TRANSLATE_IDLE_MS
      ) {
        this.finalizeGoogleLiveTranslateTurn(true);
      }
    }, 500);
  }

  stopGoogleTranslateMonitor() {
    if (this.googleTranslateMonitor) {
      clearInterval(this.googleTranslateMonitor);
      this.googleTranslateMonitor = null;
    }
  }

  /**
   * Dual-family arbitration for one Qwen realtime transcript delta.
   *
   * With modalities=[text,audio] DashScope streams the SAME sentence through
   * BOTH response.text.delta and response.audio_transcript.delta. Naively
   * appending both duplicates every reply. Faithful port of VoiceSpirit
   * 821a7a8's arbitration:
   *
   *   - a clean text delta claims the response immediately (held audio is
   *     discarded — text is the better transcript);
   *   - the FIRST audio_transcript delta is held for one event so a
   *     near-simultaneous text delta can still win;
   *   - a second audio_transcript delta locks the response to that family,
   *     replaying the held fragment first;
   *   - cross-family continuation after a decision passes a novelty predicate
   *     (streamingNovelty); novel chunks are forwarded VERBATIM and recorded,
   *     and an identical chunk arriving later from the owning family is
   *     consumed against that record instead of being published twice.
   *
   * Every forwarded chunk carries authoritative whitespace (" world" opens a
   * word, "ful" continues one) — nothing here trims mid-turn or re-spaces.
   *
   * @param {string} responseId owning response id
   * @param {'text'|'audio_transcript'} family which delta family arrived
   * @param {string} rawDelta verbatim provider delta
   * @returns {string[]} chunks to publish, in order ('' never included)
   */
  arbitrateQwenTextDelta(responseId, family, rawDelta) {
    if (!this.qwenFamilyState[responseId]) {
      this.qwenFamilyState[responseId] = {
        decided: '',
        heldAudio: '',
        accumulatedText: '',
        // Chunks already published by the NON-owning family while it was
        // silent, awaiting their duplicate from the owning family.
        injected: [],
      };
    }
    const fstate = this.qwenFamilyState[responseId];

    let delta = String(rawDelta ?? '');
    if (!delta) return [];
    if (family === 'audio_transcript') {
      delta = cleanQwenTranscriptArtifacts(delta);
      if (!delta) return [];
    }

    let deltasToEmit;
    let crossFamily = false;
    if (fstate.decided) {
      if (family === fstate.decided) {
        deltasToEmit = [delta];
      } else {
        // The losing family's frames are cumulative-shaped ("the sentence so
        // far"), so publish only the NOVEL suffix — forwarding the raw frame
        // verbatim would re-print the opening it replays ("Hello" + "Hel" ->
        // "HelloHel"). streamingNovelty already refuses rewound snapshots.
        const { novel } = streamingNovelty(fstate.accumulatedText, delta);
        if (!novel) return [];
        deltasToEmit = [novel];
        crossFamily = true;
      }
    } else if (family === 'text') {
      // Clean LLM text claims the response immediately; any held
      // audio_transcript fragment loses.
      fstate.decided = 'text';
      fstate.heldAudio = '';
      deltasToEmit = [delta];
    } else if (!fstate.heldAudio) {
      // First audio_transcript delta: hold one event window.
      fstate.heldAudio = delta;
      return [];
    } else {
      // Second audio_transcript delta, no text in sight: lock the family and
      // replay the held opening fragment ahead of the current one.
      fstate.decided = 'audio_transcript';
      deltasToEmit = [fstate.heldAudio, delta];
      fstate.heldAudio = '';
    }

    const emitted = [];
    for (const chunk of deltasToEmit) {
      if (!chunk) continue;
      const acc = fstate.accumulatedText;
      // Mirrors appendAssistantDelta: only the response's opening fragment
      // may lose a stray leading pad; later fragments' whitespace bounds them
      // against what came before.
      const text = acc ? chunk : chunk.replace(/^\s+/, '');
      if (!text) continue;
      if (!crossFamily && fstate.injected.includes(text)) {
        // The other family already published this exact chunk while silent;
        // publishing again would duplicate the sentence on screen.
        fstate.injected.splice(fstate.injected.indexOf(text), 1);
        continue;
      }
      fstate.accumulatedText = `${acc}${text}`;
      if (crossFamily) {
        fstate.injected.push(text);
      }
      emitted.push(text);
    }

    // Bound the table: responses are sequential; evict the oldest entry.
    const ids = Object.keys(this.qwenFamilyState);
    if (ids.length > 8) {
      delete this.qwenFamilyState[ids[0]];
    }
    return emitted;
  }

  setHero(heroConfig) {
    this.currentHero = heroConfig;
    console.log(`[CloudVoiceEngine] Injected Hero Persona: ${heroConfig?.nameZh} (${heroConfig?.id})`);
    if (this.isConnected) {
      if (this.provider === 'doubao' || this.provider === 'qwen' || this.provider === 'dashscope') {
        this.sendSessionUpdate();
      } else if (this.provider === 'google') {
        // Chat sessions bake systemInstruction into the Live setup message and
        // there is no mid-session update primitive — reconnect so the new
        // persona takes effect. Translate sessions have no persona at all,
        // so they keep running uninterrupted.
        this.disconnect();
        this.connect();
      }
    }
  }

  setProvider(providerName) {
    const normalized = (providerName === 'cloud-stream' || providerName === 'cartesia-deepseek') ? 'cartesia' : providerName;
    if (this.provider === normalized && this.isConnected) return;
    this.provider = normalized;
    console.log(`[CloudVoiceEngine] Switched voice provider to: ${normalized}`);
    this.disconnect();
    this.connect();
  }

  /**
   * Change the Live Translate target language (BCP-47 code, e.g. 'en',
   * 'zh-Hans'). translationConfig is baked into the setup frame of a session
   * and there is no mid-session update primitive, so a live translate
   * session reconnects for the new language to take effect. Chat and other
   * providers are unaffected — the value only matters to google-translate.
   */
  setTranslateTargetLanguage(langCode) {
    const lang = String(langCode || '').trim();
    if (!lang || lang === this.translateTargetLanguage) return;
    this.translateTargetLanguage = lang;
    console.log(`[CloudVoiceEngine] Live Translate target language set to: ${lang}`);
    if (this.provider === 'google-translate' && (this.isConnected || this.isConnecting)) {
      this.disconnect();
      this.connect();
    }
  }

  getHeroSystemPrompt(mode = 'auto') {
    const heroNameZh = this.currentHero?.nameZh || '英雄';
    const heroNameEn = this.currentHero?.nameEn || this.currentHero?.id || 'Hero';
    const heroCustomPrompt = this.currentHero?.systemPrompt || '';
    const catchphrases = (this.currentHero?.catchphrases || []).join(' / ');

    const isEnglishMode = (mode === 'en') || (mode === 'auto' && (this.provider === 'cartesia' || this.provider === 'cloud-stream'));

    // 0. Free-Chat Companion Mode: no hero persona locked in. Casual chat by
    // default; the MODEL handles smart routing — adopting any hero's persona
    // when the summoner addresses one, and sliding back to companion mode
    // afterwards. No client-side intent detection needed.
    if (!this.currentHero || FREE_CHAT_HERO_IDS.has(String(this.currentHero.id || ''))) {
      if (isEnglishMode) {
        return `You are DotaPet, the summoner's AI desktop companion for real-time voice chat — a warm, witty friend who knows DOTA 2 inside out.
Default mode — FREE CHAT: no fixed character. Talk about anything: daily life, mood, fun stories, or general DOTA 2 strategy.
Role-play on demand: when the summoner asks to chat with a specific DOTA 2 hero or asks you to BE one ("be Pudge", "talk like Invoker"), instantly adopt that hero's first-person persona — personality, tone, and signature catchphrases — and stay in character while it lasts.
Coach mode: when the summoner merely asks about a hero's playstyle/builds/counters without requesting role-play, remain the companion and answer as a veteran DOTA 2 coach.
Exit rule: role-play only lasts while addressed. Slide naturally back to companion mode once the topic returns to everyday life. Never flip characters unprompted.
Rules:
1. Keep replies concise, punchy, and spoken-style (1-3 sentences max), tailored for fast-paced voice chat.
2. **PURE ENGLISH REQUIREMENT**: ALWAYS respond strictly in fluent, natural English regardless of what language the user speaks.`;
      }
      return `你是召唤师的桌面语音伴侣「刀塔宠物」，一位有温度、懂游戏的 AI 伙伴，与玩家进行实时语音闲聊。
【默认·漫聊模式】不扮演任何英雄：生活日常、心情吐槽、趣事见闻、DOTA 2 战术泛聊都可以聊，语气像老朋友一样自然轻松。
【角色扮演】当召唤师点名想和某位 DOTA 2 英雄聊天、或要求你扮演某个英雄（例如"你现在是帕吉""用祈求者的口吻说话"）时，立即切换成该英雄的第一人称口吻——贴合其性格、语气与经典台词，陪聊、答疑都要入戏。
【教练视角】当召唤师只是询问某位英雄的玩法、出装、克制关系而没有要求扮演时，保持伴侣身份，以资深 DOTA 2 教练的口吻给出具体建议。
【出戏规则】扮演只在被点名期间成立；召唤师把话题拉回日常生活时，自然回到伴侣身份，不要自作主张地反复切换角色。
回答保持简短口语化（1~3 句），适合实时语音节奏。【中英双语自适应】召唤师用哪种语言交流，就主要用哪种语言回应；涉及战术报点时可自然夹杂游戏英文术语（如 Smoke Gank、Roshan Timing）。`;
    }

    // 0.5 Desktop Pet Persona: the summoner is chatting with the courier pet
    // walking on their desktop (信使小驴 etc.). Never fall through to the hero
    // template — that is exactly how "选了信使，开口却是英雄" happened.
    if (this.currentHero?.kind === 'pet') {
      const petLore = this.currentHero.systemPrompt || 'DOTA 2 战场上的忠实小跟班';
      const petCatchphrases = catchphrases || '咿昂~';
      if (isEnglishMode) {
        return `You are "${this.currentHero.nameEn || this.currentHero.nameZh}", the summoner's desktop pet courier for real-time voice chat — a cute, loyal little creature from the DOTA 2 battlefield.
Your Lore & Persona: ${petLore}
Signature Catchphrases: ${petCatchphrases}
Rules:
1. Speak in first person as this pet: playful, warm, with charming vocal tics — never pretend to be a hero.
2. You have couriered through thousands of matches, so you may chat about DOTA 2 items, tactics and battlefield stories from a courier's point of view.
3. Keep replies concise, punchy, and spoken-style (1-3 sentences max), tailored for fast-paced voice chat.
4. **PURE ENGLISH REQUIREMENT**: ALWAYS respond strictly in fluent, natural English regardless of what language the user speaks.`;
      }
      return `你现在是召唤师桌面的萌宠信使【${heroNameZh}】，以第一人称与召唤师进行实时语音互动。
你的设定：${petLore}
经典口头禅：${petCatchphrases}
规则要求：
1. 始终以这只萌宠的第一人称口吻说话——活泼可爱、语气词丰富（如"咿昂~""嗷呜~"），可以聊送货日常、被喂吃树、驮魔瓶等信使生活，但不要把自己扮成英雄。
2. 你是见过成千上万场对局的老信使：召唤师聊到 DOTA 2 战术、出装、局势时，用萌宠的视角给出忠实伙伴式的回应与见闻。
3. 回答保持简短口语化（1~3 句），适合实时语音节奏。
4. 【中英双语自适应】召唤师用哪种语言交流，就主要用哪种语言回应；涉及战术时可自然夹杂游戏英文术语（如 Smoke Gank、Roshan Timing）。`;
    }

    // 1. Cartesia Route: Pure English Immersion Mode
    if (isEnglishMode) {
      return `You are the legendary DOTA 2 hero "${heroNameEn} (${heroNameZh})" serving as the summoner's real-time desktop companion and native English tactical coach.
Your Lore & Persona: ${heroCustomPrompt}
Signature Catchphrases: ${catchphrases}
Rules:
1. Speak in first person as "${heroNameEn}" with authentic DOTA 2 hero flavor and immersive personality.
2. Keep replies concise, punchy, and clear (1-3 sentences max), tailored for fast-paced in-game voice communication.
3. Master all DOTA 2 competitive mechanics: item builds, skill combos, timings, lane control, Roshan, buybacks, and map rotation.
4. **PURE ENGLISH REQUIREMENT**: ALWAYS respond strictly in fluent, natural English regardless of what language the user speaks. Even if the user asks in Chinese, understand their intent and answer in natural English with authentic DOTA 2 terms (providing pure English listening & speaking practice).`;
    }

    // 2. Doubao & Qwen Route: Bilingual Adaptive Mode (中英双语自适应)
    return `你现在是《DOTA 2》中的英雄【${heroNameZh} (${heroNameEn})】，作为玩家的桌面伴侣与中英双语对局战术教练进行实时语音互动。
你的性格特点：${heroCustomPrompt}
经典台词口头禅：${catchphrases}
规则要求：
1. 以第一人称（【${heroNameZh}】）的身份与召唤师（玩家）对话，语气自然生动，符合该英雄的人设与性格特征。
2. 保持回答简短有力（在对局语音中尽量在1~3句话内讲清核心信息，语速清晰明了）。
3. 精通DOTA 2所有英雄、技能、装备、出装加点、战术走位、买活时机、打盾控符等竞技知识。
4. 【中英双语自适应】：
   - 当召唤师使用中文交流时，用自然地道的中文回答，并在涉及核心战术或快捷报点时适时附带游戏英文术语（如 Smoke Gank、Roshan Timing、BKB Piercing 等）。
   - 当召唤师使用英文交流或英文报点（如 "push mid", "smoke top", "what item next"）时，用流利地道的英语或双语进行即时战术呼应与指导。
   - 当召唤师询问游戏英文翻译或如何用英语交流时，给出精准地道的对局英文用语与解释。`;
  }

  /**
   * Dynamic Language-Aware Female Voice Switching:
   * When user speaks English -> switches to the English female voice (Jennifer)
   * When user speaks Chinese -> switches to the Chinese female voice (Tina)
   *
   * Doubao is deliberately NOT switched here. Its en_* voices (Dacey etc.)
   * are American-English ONLY (official duplex doc: 仅支持英语，O2.0 版本),
   * so once an English utterance flipped the voice, every later Chinese
   * reply died server-side with "the voice you selected doesn't support
   * this language" — and DOTA callouts mix 中英 constantly, tripping the
   * detector by accident. The pinned default xiaohe handles both languages
   * well (Taiwan-accented), so it stays for the whole session.
   */
  adaptVoiceForLanguage(lang = 'zh') {
    if (!this.autoVoice) return;
    if (this.provider === 'qwen' || this.provider === 'dashscope') {
      const targetVoice = FEMALE_VOICES.qwen[lang] || FEMALE_VOICES.qwen.zh;
      if (this.voice !== targetVoice) {
        console.log(`[CloudVoiceEngine] Language detected [${lang}], dynamically switching Qwen female voice: ${this.voice || 'default'} -> ${targetVoice}`);
        this.voice = targetVoice;
        this.sendSessionUpdate();
      }
    }
  }

  connect() {
    loadEnv();
    if (this.provider === 'cartesia' || this.provider === 'cloud-stream' || this.provider === 'cartesia-deepseek') {
      this.connectCartesiaPipeline();
      return;
    }

    if (this.provider === 'doubao') {
      this.connectDoubaoRealtime();
      return;
    }

    if (this.provider === 'qwen' || this.provider === 'dashscope' || this.provider === 'dashscope-ws') {
      this.connectQwenRealtime();
      return;
    }

    if (this.provider === 'google' || this.provider === 'google-translate') {
      this.connectGoogleLive();
      return;
    }

    this.emit('status', { status: 'error', error: '不支持的实时语音服务商。', providerId: this.provider });
  }

  // ------------------------------------------------------------------
  // Provider 1: Cartesia Ink-2 STT + DeepSeek-Flash LLM + Sonic TTS (English Practice)
  // ------------------------------------------------------------------
  connectCartesiaPipeline() {
    loadEnv();
    const cartesiaKey = this.apiKey || CLOUD_KEYS.cartesia;

    if (!cartesiaKey || !CLOUD_KEYS.cartesia_llm_key) {
      this.emit('status', { status: 'error', providerId: 'cartesia', error: '缺少 Cartesia 或 DeepSeek 密钥，请打开 AI 设置。', provider: 'Cartesia + DeepSeek' });
      return;
    }

    this.isConnecting = true;
    this.suppressReconnect = false;
    this.cartesiaIsSttOpen = false;
    this.cartesiaIsTtsOpen = false;
    this.emit('status', { status: 'connecting', providerId: 'cartesia', provider: 'Cartesia + DeepSeek (English Voice 对局纯英对练)' });

    const sttUrl = `wss://api.cartesia.ai/stt/turns/websocket?model=ink-2&encoding=pcm_s16le&sample_rate=16000&cartesia_version=${CARTESIA_VERSION}&language=en`;
    const ttsUrl = `wss://api.cartesia.ai/tts/websocket?cartesia_version=${CARTESIA_VERSION}`;

    const headers = {
      Authorization: `Bearer ${cartesiaKey}`,
      'Cartesia-Version': CARTESIA_VERSION,
    };

    try {
      // 1. Connect Cartesia Ink-2 STT WebSocket
      const sttSocket = new WebSocket(sttUrl, { headers });
      this.cartesiaSttWs = sttSocket;

      sttSocket.on('open', () => {
        if (this.cartesiaSttWs !== sttSocket) return;
        this.cartesiaIsSttOpen = true;
        this.checkCartesiaReady();
      });

      sttSocket.on('message', (data) => {
        if (this.cartesiaSttWs !== sttSocket) return;
        try {
          const event = JSON.parse(data.toString());
          this.handleCartesiaSttEvent(event);
        } catch (e) {
          console.error('[CloudVoiceEngine] Cartesia STT message error:', e);
        }
      });

      sttSocket.on('error', (err) => {
        if (this.cartesiaSttWs !== sttSocket) return;
        console.warn('[CloudVoiceEngine] Cartesia STT WS error:', err.message);
      });

      sttSocket.on('close', (code, reason) => {
        if (this.cartesiaSttWs !== sttSocket) return;
        this.cartesiaIsSttOpen = false;
        console.log(`[CloudVoiceEngine] Cartesia STT WS closed: code=${code}`);
        if (code === 401) {
          this.isConnected = false;
          this.isConnecting = false;
          this.emit('status', {
            status: 'error',
            error: 'Cartesia 鉴权失败 (HTTP 401)。请检查 Cartesia API Key 是否有效。',
            provider: 'Cartesia + DeepSeek-Flash',
          });
          return;
        }
        // Clear the "both sockets open" flag or the reconnect guard will
        // believe a live session still exists and refuse to schedule.
        this.isConnected = false;
        this.isConnecting = false;
        this.scheduleReconnect();
      });

      // 2. Connect Cartesia Sonic TTS WebSocket
      const ttsSocket = new WebSocket(ttsUrl, { headers });
      this.cartesiaTtsWs = ttsSocket;

      ttsSocket.on('open', () => {
        if (this.cartesiaTtsWs !== ttsSocket) return;
        this.cartesiaIsTtsOpen = true;
        this.checkCartesiaReady();
      });

      ttsSocket.on('message', (data) => {
        if (this.cartesiaTtsWs !== ttsSocket) return;
        try {
          const event = JSON.parse(data.toString());
          this.handleCartesiaTtsEvent(event);
        } catch (e) {
          console.error('[CloudVoiceEngine] Cartesia TTS message error:', e);
        }
      });

      ttsSocket.on('error', (err) => {
        if (this.cartesiaTtsWs !== ttsSocket) return;
        console.warn('[CloudVoiceEngine] Cartesia TTS WS error:', err.message);
      });

      ttsSocket.on('close', (code, reason) => {
        if (this.cartesiaTtsWs !== ttsSocket) return;
        this.cartesiaIsTtsOpen = false;
        console.log(`[CloudVoiceEngine] Cartesia TTS WS closed: code=${code}`);
        if (code === 401) {
          this.isConnected = false;
          this.isConnecting = false;
          this.emit('status', {
            status: 'error',
            error: 'Cartesia 鉴权失败 (HTTP 401)。请检查 Cartesia API Key 是否有效。',
            provider: 'Cartesia + DeepSeek-Flash',
          });
          return;
        }
        this.isConnected = false;
        this.isConnecting = false;
        this.scheduleReconnect();
      });
    } catch (err) {
      console.error('[CloudVoiceEngine] Failed to init Cartesia WS:', err);
      this.emit('status', { status: 'error', error: err.message, provider: 'Cartesia + DeepSeek-Flash' });
    }
  }

  checkCartesiaReady() {
    if (this.cartesiaIsSttOpen && this.cartesiaIsTtsOpen) {
      this.isConnected = true;
      this.isConnecting = false;
      this.suppressOutput = false;
      this.sessionId = generateEventId('sess_cartesia');
      console.log('[CloudVoiceEngine] Connected to Cartesia (Ink-2 STT + Sonic TTS) & DeepSeek-Flash Engine');
      this.emit('status', { status: 'connected', providerId: 'cartesia', provider: 'Cartesia + DeepSeek-Flash (极速流)' });
      this.emit('session_ready', { sessionId: this.sessionId, provider: 'Cartesia-DeepSeek' });
    }
  }

  handleCartesiaSttEvent(event) {
    if (!event) return;
    const type = event.type || '';

    switch (type) {
      case 'turn.start':
        // Semantic barge-in: user started speaking
        console.log('[CloudVoiceEngine] Cartesia Ink-2: turn.start (Barge-in)');
        this.interruptCartesia();
        this.emit('user_speech_start');
        break;

      case 'turn.end': {
        const transcript = (event.transcript || '').trim();
        console.log('[CloudVoiceEngine] Cartesia Ink-2: turn.end ->', transcript);
        this.emit('user_speech_end');
        if (transcript) {
          this.emit('speech_final', transcript);
          this.startCartesiaTurn(transcript);
        }
        break;
      }

      case 'error':
        console.warn('[CloudVoiceEngine] Cartesia STT error event:', event.message || event);
        break;

      default:
        break;
    }
  }

  handleCartesiaTtsEvent(event) {
    if (!event) return;
    const type = event.type || '';
    const contextId = event.context_id || '';

    if (type === 'chunk') {
      if (this.suppressOutput || (this.cartesiaContextId && contextId !== this.cartesiaContextId)) {
        return;
      }
      const audioB64 = event.data || event.audio || '';
      if (audioB64) {
        this.ttsActive = true;
        this.turnHadAudio = true;
        const buffer = Buffer.from(audioB64, 'base64');
        this.emit('agent_audio_chunk', {
          buffer: buffer,
          audioBase64: audioB64,
          sampleRate: 24000,
          turnId: contextId,
        });
      }
    } else if (type === 'done') {
      if (this.cartesiaContextId && contextId === this.cartesiaContextId) {
        this.ttsActive = false;
        this.emit('agent_complete', { text: this.aiAcc, turnId: contextId, hadAudio: this.turnHadAudio });
        this.aiAcc = '';
        this.turnHadAudio = false;
        this.cartesiaContextId = null;
      }
    } else if (type === 'error') {
      console.warn('[CloudVoiceEngine] Cartesia TTS error event:', event.message || event.error);
    }
  }

  interruptCartesia() {
    this.suppressOutput = true;
    this.ttsActive = false;
    this.emit('interrupted', { interrupted: true });

    if (this.cartesiaAbortController) {
      try {
        this.cartesiaAbortController.abort();
      } catch (e) {}
      this.cartesiaAbortController = null;
    }

    if (this.cartesiaTtsWs && this.cartesiaTtsWs.readyState === WebSocket.OPEN && this.cartesiaContextId) {
      try {
        this.cartesiaTtsWs.send(JSON.stringify({ context_id: this.cartesiaContextId, cancel: true }));
      } catch (e) {}
    }
  }

  async startCartesiaTurn(userText) {
    if (!userText || !userText.trim()) return;
    const trimmed = userText.trim();

    this.interruptCartesia();
    this.suppressOutput = false;
    this.ttsActive = true;

    const contextId = generateEventId('turn_car');
    this.cartesiaContextId = contextId;
    this.activeTurnId = contextId;
    this.aiAcc = '';
    this.turnHadAudio = false;

    this.emit('agent_audio_start', { responseId: contextId });

    const baseTtsMsg = {
      model_id: CLOUD_KEYS.cartesia_model || DEFAULT_CARTESIA_MODEL,
      voice: { mode: 'id', id: CLOUD_KEYS.cartesia_voice_id || DEFAULT_CARTESIA_VOICE },
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 },
      language: 'en',
      context_id: contextId,
      max_buffer_delay_ms: 300,
    };

    this.cartesiaHistory.push({ role: 'user', content: trimmed });
    if (this.cartesiaHistory.length > 20) {
      this.cartesiaHistory = this.cartesiaHistory.slice(-20);
    }

    this.cartesiaAbortController = new AbortController();

    const apiKey = CLOUD_KEYS.cartesia_llm_key;
    const apiUrl = 'https://api.deepseek.com/v1/chat/completions';
    const model = 'deepseek-flash';

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        signal: this.cartesiaAbortController.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: this.getHeroSystemPrompt('en') },
            ...this.cartesiaHistory,
          ],
          temperature: 0.7,
          thinking: { type: 'disabled' },
          max_tokens: 300,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullAssistantText = '';
      // SSE frames are newline-delimited but TCP reads are not: buffer the
      // trailing partial line across reads instead of JSON.parse-ing it and
      // silently swallowing the delta inside the catch below.
      let lineBuf = '';

      const consumeLine = (line) => {
        const l = line.trim();
        if (!l.startsWith('data: ') || l === 'data: [DONE]') return;
        try {
          const parsed = JSON.parse(l.slice(6));
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta && !this.suppressOutput) {
            // Clean BPE token delta: whitespace is authoritative — append
            // verbatim, never trim / re-space / dedup (see docs/
            // realtime-transcript-integrity.md §1.1).
            fullAssistantText += delta;
            this.aiAcc = fullAssistantText;
            this.emit('agent_text_delta', { delta, fullText: fullAssistantText, turnId: contextId });

            // Stream delta chunk to Cartesia Sonic TTS WS
            const cleanDelta = stripMarkdownForTts(delta);
            if (cleanDelta && this.cartesiaTtsWs && this.cartesiaTtsWs.readyState === WebSocket.OPEN) {
              this.cartesiaTtsWs.send(JSON.stringify({
                ...baseTtsMsg,
                transcript: cleanDelta,
                continue: true,
              }));
            }
          }
        } catch (e) {}
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuf += decoder.decode(value, { stream: true });
        const lines = lineBuf.split('\n');
        // The last element is an unfinished line unless the chunk ended on \n.
        lineBuf = lines.pop() ?? '';

        for (const line of lines) {
          consumeLine(line);
        }
      }
      // Flush any final unterminated line still sitting in the buffer.
      if (lineBuf) {
        consumeLine(lineBuf);
      }

      // Finish Sonic TTS context stream
      if (this.cartesiaTtsWs && this.cartesiaTtsWs.readyState === WebSocket.OPEN && !this.suppressOutput) {
        this.cartesiaTtsWs.send(JSON.stringify({
          ...baseTtsMsg,
          transcript: '',
          continue: false,
        }));
      }

      if (fullAssistantText) {
        this.cartesiaHistory.push({ role: 'assistant', content: fullAssistantText });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[CloudVoiceEngine] Cartesia turn generation error:', err);
      this.emit('agent_text_delta', { delta: `【${this.currentHero?.nameZh || '英雄'}】: 正在待命！` });
      if (this.cartesiaTtsWs && this.cartesiaTtsWs.readyState === WebSocket.OPEN) {
        try {
          this.cartesiaTtsWs.send(JSON.stringify({ ...baseTtsMsg, transcript: '', continue: false }));
        } catch (e) {}
      }
    }
  }

  // ------------------------------------------------------------------
  // Provider 2: Volcengine Doubao Duplex Realtime WebSocket (JSON)
  // ------------------------------------------------------------------
  connectDoubaoRealtime() {
    loadEnv();
    const apiKey = this.apiKey || CLOUD_KEYS.doubao_api_key || CLOUD_KEYS.doubao_access_token;

    if (!apiKey) {
      this.emit('status', { status: 'error', providerId: 'doubao', error: '豆包密钥未配置，请打开 AI 设置。', provider: 'Doubao' });
      return;
    }

    this.isConnecting = true;
    this.suppressReconnect = false;
    this.emit('status', { status: 'connecting', providerId: 'doubao', provider: '字节豆包 (Doubao Duplex)' });

    let endpoint = CLOUD_KEYS.doubao_ws_url || DEFAULT_DOUBAO_DUPLEX_ENDPOINT;
    if (endpoint.includes('/api/v3/realtime/dialogue')) {
      endpoint = DEFAULT_DOUBAO_DUPLEX_ENDPOINT;
    }

    try {
      const socket = new WebSocket(endpoint, {
        headers: {
          'X-Api-Key': apiKey,
          'user-agent': 'VoiceSpirit/Dota2Companion-Duplex',
        },
      });
      this.ws = socket;

      socket.on('open', () => {
        if (this.ws !== socket) return;
        this.isConnected = true;
        this.isConnecting = false;
        this.resetTranscriptState();

        console.log('[CloudVoiceEngine] Connected to Doubao Full-Duplex Realtime WebSocket');
        this.emit('status', { status: 'connected', providerId: 'doubao', provider: '字节豆包 (Doubao Duplex)' });

        this.sendDoubaoSessionCreate();
        this.startHeartbeat();
      });

      socket.on('message', (data) => {
        if (this.ws !== socket) return;
        try {
          const raw = typeof data === 'string' ? data : data.toString('utf-8');
          const event = JSON.parse(raw);
          this.handleDoubaoDuplexEvent(event);
        } catch (e) {
          console.error('[CloudVoiceEngine] Error parsing Doubao event:', e);
        }
      });

      socket.on('error', (err) => {
        if (this.ws !== socket) return;
        console.warn('[CloudVoiceEngine] Doubao Duplex WS error:', err.message);
        this.emit('status', { status: 'error', error: err.message, provider: '字节豆包 (Doubao Duplex)' });
      });

      socket.on('close', (code, reason) => {
        // A stale socket (superseded by reconnect / provider switch / disconnect)
        // must not clobber the live session's state or schedule a duplicate
        // connection behind the current one.
        if (this.ws !== socket) return;
        this.stopHeartbeat();
        const reasonStr = reason ? reason.toString() : '';
        console.log(`[CloudVoiceEngine] Doubao WS closed: code=${code}, reason=${reasonStr}`);

        if (code === 401 || reasonStr.includes('401')) {
          this.isConnected = false;
          this.isConnecting = false;
          this.emit('status', {
            status: 'error',
            error: '火山引擎豆包实时语音鉴权失败 (HTTP 401)。请确认配置中填写的是火山引擎控制台有效的 Access Token。',
            provider: '字节豆包 (Doubao Duplex)',
          });
          return;
        }

        if (code === 403 || reasonStr.includes('403')) {
          this.isConnected = false;
          this.isConnecting = false;
          this.emit('status', {
            status: 'error',
            error: '火山引擎豆包实时语音拒绝访问 (HTTP 403)。请检查账户余额/免费资源包。',
            provider: '字节豆包 (Doubao Duplex)',
          });
          return;
        }

        this.isConnected = false;
        this.isConnecting = false;
        this.scheduleReconnect();
      });
    } catch (err) {
      console.error('[CloudVoiceEngine] Failed to init Doubao WS:', err);
      this.emit('status', { status: 'error', error: '连接失败', provider: 'Doubao' });
    }
  }

  sendDoubaoSessionCreate() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const chosenVoice = DOUBAO_REALTIME_VOICES.includes(this.doubaoVoice)
      ? this.doubaoVoice
      : DEFAULT_DOUBAO_REALTIME_VOICE;

    const sessionPayload = {
      model: this.model || DEFAULT_DOUBAO_DUPLEX_DIALOG_MODEL,
      instructions: this.getHeroSystemPrompt(),
      audio: {
        input: { format: { type: 'pcm', rate: 16000 } },
        output: {
          format: { type: 'pcm_s16le', rate: 24000 },
          voice: chosenVoice,
        },
      },
    };

    const extension = {
      asr: { extra: {} },
      tts: { extra: {} },
      dialog: { extra: {} },
    };

    const websearchKey = CLOUD_KEYS.doubao_websearch_key;
    if (websearchKey) {
      extension.dialog.extra = {
        enable_volc_websearch: true,
        volc_websearch_type: 'web',
        volc_websearch_api_key: websearchKey,
      };
    }

    const handshakeMsg = {
      type: 'session.create',
      event_id: generateEventId('sess_create'),
      session: sessionPayload,
      extension: extension,
    };

    try {
      this.ws.send(JSON.stringify(handshakeMsg));
    } catch (e) {
      console.error('[CloudVoiceEngine] Failed to send session.create:', e);
    }
  }

  handleDoubaoDuplexEvent(event) {
    if (!event) return;
    const type = event.type || '';

    switch (type) {
      case 'session.created':
        this.sessionId = event.session?.id || '';
        this.emit('session_ready', { sessionId: this.sessionId, provider: 'Doubao' });
        break;

      case 'conversation.item.input_audio_transcription.started':
        // Barge-in: scope residue suppression to the interrupted reply instead
        // of a blanket window — a new reply's text deltas routinely arrive
        // BEFORE its own output_audio.started, and a blanket window swallowed
        // every reply's opening text (VoiceSpirit 301cd74).
        this.suppressOutput = true;
        this.userAcc = '';
        if (this.ttsActive) {
          this.suppressedResponseId = this.activeResponseId || '';
          this.turnFinalized = false;
          this.ttsActive = false;
          this.activeResponseId = null;
          this.activeTurnId = null;
          this.aiAcc = '';
          this.emit('interrupted', { interrupted: true });
        }
        this.emit('user_speech_start');
        break;

      case 'conversation.item.input_audio_transcription.delta': {
        // Protocol semantics (verified against the official web demo's
        // setQuestion usage): this frame is a full "as of now" SNAPSHOT that
        // revises backwards near the end — it must REPLACE the interim text.
        // Appending here duplicated the interim over and over until completed.
        const snapshot = String(event.delta || '');
        if (snapshot) {
          this.userAcc = snapshot;
          this.emit('speech_interim', this.userAcc);
        }
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = (event.transcript || event.text || this.userAcc || '').trim();
        if (transcript) {
          this.adaptVoiceForLanguage(detectPrimaryLanguage(transcript));
          this.emit('speech_final', transcript);
        }
        this.emit('user_speech_end');
        break;
      }

      case 'response.output_audio.started': {
        const startedId = String(event.response_id || '');
        // A reply other than the suppressed one starting means the interrupted
        // stream is truly gone → lift the window (blank windows lift on any
        // new start; see shouldLiftSuppression).
        if (shouldLiftSuppression(this.suppressedResponseId, startedId)) {
          this.suppressedResponseId = null;
        }
        this.ttsActive = true;
        if (startedId && startedId !== this.activeResponseId) {
          // Text deltas of THIS reply may have beaten their own started event
          // (301cd74): aiAcc already holds the opening words under that id —
          // announce the reply but keep them.
          const ownsPendingText =
            Boolean(this.aiAcc) && this.aiAccResponseId === startedId;
          if (ownsPendingText || !this.aiAcc || this.turnFinalized) {
            // Fresh announcement. Wipe only text owned by ANOTHER reply.
            if (!ownsPendingText) {
              this.aiAcc = '';
              this.aiAccResponseId = null;
            }
            this.activeTurnId = startedId;
            this.turnHadAudio = false;
            this.emit('agent_audio_start', { responseId: startedId });
          } else {
            // Segment continuation: the server may split one logical reply
            // into several response_ids; aiAcc holds the previous segment's
            // text as the output_text.done reconciliation baseline and the
            // next segment started before it finalized — keep it, no
            // re-announcement.
            this.activeTurnId = startedId;
          }
          this.activeResponseId = startedId;
          this.turnFinalized = false;
        } else if (!startedId && !this.activeResponseId) {
          // No ids on the wire at all: treat as a fresh reply so text still
          // accumulates from zero instead of gluing onto a stale turn.
          this.aiAcc = '';
          this.aiAccResponseId = null;
          this.activeTurnId = generateEventId('resp');
          this.turnHadAudio = false;
          this.emit('agent_audio_start', { responseId: this.activeTurnId });
          this.turnFinalized = false;
        }
        break;
      }

      case 'response.output_audio.delta': {
        if (isOutputSuppressed(this.suppressedResponseId, event.response_id)) return;
        // Same identity-scoped guard as text: no phantom playback of the
        // just-finalized reply, while a genuinely new reply (id not yet seen,
        // possibly pre-started) still gets through.
        if (
          this.turnFinalized &&
          (!event.response_id || String(event.response_id) === this.lastFinalizedResponseId)
        ) {
          return;
        }
        const audioB64 = event.delta || '';
        if (audioB64) {
          this.ttsActive = true;
          this.turnHadAudio = true;
          const buffer = Buffer.from(audioB64, 'base64');
          this.emit('agent_audio_chunk', {
            buffer: buffer,
            audioBase64: audioB64,
            sampleRate: 24000,
            turnId: this.activeTurnId,
          });
        }
        break;
      }

      case 'response.output_audio.done': {
        // A done belonging to the interrupted stream (or any done while a
        // blank post-barge-in window is armed) is residue: drop it silently —
        // but DO lift the window. Synthesis of that reply has ended, so none
        // of it can play afterwards; a lingering (especially blank) window
        // would otherwise swallow the NEXT reply's pre-started opening text.
        // Mirrors VoiceSpirit realtime_doubao_provider.py, which clears the
        // targeted suppression on the suppressed done.
        if (isOutputSuppressed(this.suppressedResponseId, event.response_id)) {
          this.suppressedResponseId = null;
          return;
        }
        // A tail done of an EARLIER segment whose successor is already
        // streaming must not finalize the active segment: record its id so
        // its own stragglers stay blocked and let the live segment finish.
        const staleDoneId = String(event.response_id || '');
        if (
          !this.turnFinalized &&
          staleDoneId &&
          this.activeResponseId &&
          staleDoneId !== this.activeResponseId
        ) {
          this.lastFinalizedResponseId = staleDoneId;
          return;
        }
        if (this.turnFinalized) return;
        this.ttsActive = false;
        this.emit('agent_complete', { text: this.aiAcc, turnId: this.activeTurnId, hadAudio: this.turnHadAudio });
        this.aiAcc = '';
        this.userAcc = '';
        this.turnHadAudio = false;
        this.aiAccResponseId = null;
        // Record the finished reply by ITS OWN id — in segmented replies
        // activeResponseId may already belong to the next segment.
        this.lastFinalizedResponseId =
          String(event.response_id || '') || this.activeResponseId || null;
        this.activeTurnId = null;
        this.activeResponseId = null;
        this.suppressedResponseId = null;
        this.turnFinalized = true;
        break;
      }

      case 'response.output_text.delta': {
        if (isOutputSuppressed(this.suppressedResponseId, event.response_id)) return;
        // Post-finalize residue of the reply that JUST completed must not
        // resurrect — but a NEW reply's leading deltas legitimately arrive
        // before its own output_audio.started, so the drop is scoped by
        // response identity rather than a blanket finalized flag.
        if (
          this.turnFinalized &&
          (!event.response_id || String(event.response_id) === this.lastFinalizedResponseId)
        ) {
          return;
        }
        const delta = String(event.delta || '');
        if (delta) {
          const rid = String(event.response_id || '');
          // Ownership bookkeeping: text arriving under a different id after a
          // finalize belongs to a genuinely new reply — start it clean.
          if (rid && this.aiAccResponseId !== rid && (!this.aiAcc || this.turnFinalized)) {
            this.aiAcc = '';
            this.aiAccResponseId = null;
          }
          if (rid) {
            this.aiAccResponseId = rid;
          }
          // Clean token delta: append verbatim (appendAssistantDelta only
          // lstrips the very first fragment of the turn).
          this.aiAcc = appendAssistantDelta(this.aiAcc, delta);
          this.emit('agent_text_delta', { delta, fullText: this.aiAcc, turnId: this.activeTurnId });
        }
        break;
      }

      case 'response.output_text.done': {
        const responseId = String(event.response_id || '');
        if (isOutputSuppressed(this.suppressedResponseId, responseId)) return;
        // turn_finalized guard: after finalize, only residue of THAT reply
        // (same id / no id) is blocked — a genuinely new reply's done may
        // legitimately beat its own started and must still reconcile.
        if (
          this.turnFinalized &&
          (!responseId || responseId === this.lastFinalizedResponseId)
        ) {
          return;
        }
        // Authoritative text of an ALREADY-SUPERSEDED segment cannot be
        // reconciled against a baseline that now also contains newer segments'
        // text — reconciling would either warn-diverge or double-splice the
        // prefix. Only the segment that owns the current baseline may heal it.
        if (responseId && this.aiAccResponseId && responseId !== this.aiAccResponseId) {
          break;
        }
        // done.text is the server's authoritative whole transcript. Reconcile
        // against what was streamed forward: publish exactly the missing
        // suffix (self-heals any gap) and refuse to splice on divergence
        // instead of double-publishing the prefix.
        const suffix = missingTextSuffix(this.aiAcc, String(event.text || ''), (acc, fin) => {
          console.warn(
            `[CloudVoiceEngine] Doubao output_text.done diverged from streamed deltas: acc=${JSON.stringify(acc.slice(0, 120))} done=${JSON.stringify(fin.slice(0, 120))}`
          );
        });
        if (suffix) {
          if (responseId) {
            this.aiAccResponseId = responseId;
          }
          this.aiAcc = appendAssistantDelta(this.aiAcc, suffix);
          this.emit('agent_text_delta', { delta: suffix, fullText: this.aiAcc, turnId: this.activeTurnId });
        }
        break;
      }

      case 'session.closed':
        this.isConnected = false;
        this.emit('session_closed');
        break;

      case 'error': {
        const errObj = event.error || event;
        const errMsg = typeof errObj === 'object' ? (errObj.message || JSON.stringify(errObj)) : String(errObj);
        console.warn('[CloudVoiceEngine] Doubao error event:', errMsg);
        this.emit('status', { status: 'error', error: errMsg, provider: '字节豆包 (Doubao Duplex)' });
        break;
      }

      default:
        break;
    }
  }

  // ------------------------------------------------------------------
  // Provider 3: DashScope Qwen-Audio / Qwen-Omni Realtime WS
  // ------------------------------------------------------------------
  connectQwenRealtime() {
    loadEnv();
    const apiKey = this.apiKey || CLOUD_KEYS.dashscope;
    if (!apiKey) {
      this.emit('status', { status: 'error', providerId: 'qwen', error: '千问密钥未配置，请打开 AI 设置。', provider: 'Qwen' });
      return;
    }

    this.isConnecting = true;
    this.suppressReconnect = false;
    this.emit('status', { status: 'connecting', providerId: 'qwen', provider: '阿里千问 (Qwen-Audio Realtime)' });

    const modelName = this.model && this.model.startsWith('qwen') ? this.model : (process.env.DASHSCOPE_REALTIME_MODEL || DEFAULT_DASHSCOPE_REALTIME_MODEL);
    let wsUrl = CLOUD_KEYS.dashscope_ws_url || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
    if (!wsUrl.includes('model=')) {
      const sep = wsUrl.includes('?') ? '&' : '?';
      wsUrl = `${wsUrl}${sep}model=${encodeURIComponent(modelName)}`;
    }

    try {
      const socket = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'user-agent': 'VoiceSpirit/Dota2Companion',
        },
      });
      this.ws = socket;

      socket.on('open', () => {
        if (this.ws !== socket) return;
        this.isConnected = false;
        this.resetTranscriptState();
        console.log(`[CloudVoiceEngine] Connected to DashScope Qwen Realtime WS (${modelName})`);

        this.sendSessionUpdate();
        this.startHeartbeat();
      });

      socket.on('message', (data, isBinary) => {
        if (this.ws !== socket) return;
        if (isBinary) {
          if (this.suppressOutput) return;
          this.turnHadAudio = true;
          this.emit('agent_audio_chunk', {
            buffer: data,
            sampleRate: 24000,
          });
          return;
        }

        try {
          const msg = JSON.parse(data.toString());
          this.handleQwenRealtimeEvent(msg);
        } catch (e) {
          console.error('[CloudVoiceEngine] Error parsing Qwen event:', e);
        }
      });

      socket.on('error', (err) => {
        if (this.ws !== socket) return;
        console.warn('[CloudVoiceEngine] Qwen WS connection notice:', err.message);
        this.emit('status', { status: 'error', error: err.message, provider: '阿里千问 (Qwen-Audio)' });
      });

      socket.on('close', (code, reason) => {
        if (this.ws !== socket) return;
        this.stopHeartbeat();
        this.isConnected = false;
        this.isConnecting = false;
        if (code === 401 || (reason && reason.toString().includes('401'))) {
          this.emit('status', { status: 'error', error: 'HTTP 401', provider: 'Qwen' });
          return;
        }
        this.scheduleReconnect();
      });
    } catch (err) {
      console.error('[CloudVoiceEngine] Failed to init Qwen WS:', err);
      this.emit('status', { status: 'error', error: '连接失败', provider: 'Qwen' });
    }
  }

  handleQwenRealtimeEvent(msg) {
    if (!msg) return;

    // Untyped error envelope (e.g. {"code": "AccessDenied", "message": "Access denied", "request_id": "..."})
    if (!msg.type && (msg.code || msg.message)) {
      const errMsg = msg.message || msg.code || 'DashScope 拒绝访问';
      console.warn(`[CloudVoiceEngine] DashScope untyped error: code=${msg.code}, message=${msg.message}`);
      this.emit('status', {
        status: 'error',
        error: `DashScope 服务端拒绝: ${errMsg} (code: ${msg.code || 'unknown'})`,
        provider: '阿里千问 (DashScope Realtime)',
      });
      return;
    }

    const type = msg.type || '';

    switch (type) {
      case 'session.created':
        this.sessionId = msg.session?.id || '';
        this.emit('session_ready', { sessionId: this.sessionId, provider: 'Qwen' });
        break;

      case 'session.updated':
        this.isConnected = true;
        this.isConnecting = false;
        this.emit('status', { status: 'connected', providerId: 'qwen', provider: `阿里千问 (${this.model || DEFAULT_DASHSCOPE_REALTIME_MODEL})` });
        this.emit('session_configured', { sessionId: this.sessionId, provider: 'Qwen' });
        // Session updated event acknowledged
        break;

      case 'input_audio_buffer.speech_started': {
        this.suppressOutput = true;
        this.ttsActive = false;
        // Targeted interruption: record active response ID into suppression set
        const interruptedId = String(this.activeTurnId || this.activeResponseId || '');
        if (interruptedId) {
          this.qwenSuppressedResponseIds.add(interruptedId);
        }
        // The interrupted reply is cancelled server-side; its still-HELD
        // fragment must die here or response.done would force-settle a ghost
        // opener of a reply that was never allowed to speak.
        this.qwenFamilyState = {};
        this.emit('user_speech_start');
        this.emit('interrupted', { interrupted: true });
        break;
      }

      case 'input_audio_buffer.speech_stopped':
        // Speech ended. Note: do NOT unsuppress this.qwenSuppressedResponseIds here!
        // The interrupted response's late chunks still belong to that response ID.
        this.suppressOutput = false;
        this.emit('user_speech_end');
        break;

      case 'response.created':
      case 'response.output_item.added': {
        // response.created carries response.id; response.output_item.added
        // carries response_id / item.id instead — resolve all shapes before
        // falling back to a synthetic id.
        const newRespId =
          String(msg.response?.id || msg.response_id || msg.item?.id || '') ||
          generateEventId('qwen_resp');

        // If this response is already in the suppressed set, ignore it
        if (this.qwenSuppressedResponseIds.has(newRespId)) {
          return;
        }

        this.suppressOutput = false;
        this.ttsActive = true;
        // A fresh response starts with a clean arbitration record; drop any
        // stale record from an earlier response so held/injected state can
        // never bleed across turns.
        this.qwenFamilyState = {};
        this.activeTurnId = newRespId;
        this.activeResponseId = newRespId;
        this.aiAcc = '';
        this.turnHadAudio = false;
        this.emit('agent_audio_start', { responseId: newRespId });
        break;
      }

      case 'conversation.item.input_audio_transcription.delta':
      case 'conversation.item.input_audio_transcription.text': {
        // Two defensive shapes (mirrors VoiceSpirit qwen provider): `.delta`
        // is an incremental fragment of THIS item's transcript → accumulate
        // per item_id; `.text` (+ optional `stash`) is a cumulative frame →
        // wholesale replace. Emitting raw fragments as full interim text made
        // the recognition box flash only the last syllable.
        const itemId = String(msg.item_id || 'qwen_item');
        let interimText;
        if (msg.delta !== undefined && msg.delta !== null) {
          interimText = (this.qwenInterimByItem[itemId] || '') + String(msg.delta);
        } else {
          interimText = String(msg.text || '') + String(msg.stash || '');
        }
        this.qwenInterimByItem[itemId] = interimText;
        const interimIds = Object.keys(this.qwenInterimByItem);
        if (interimIds.length > 8) {
          delete this.qwenInterimByItem[interimIds[0]];
        }
        if (interimText.trim()) this.emit('speech_interim', interimText);
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        delete this.qwenInterimByItem[String(msg.item_id || '')];
        const transcript = (msg.transcript || '').trim();
        if (transcript) {
          this.adaptVoiceForLanguage(detectPrimaryLanguage(transcript));
          this.emit('speech_final', transcript);
        }
        break;
      }

      case 'response.audio.delta': {
        const rid = String(msg.response_id || this.activeTurnId || '');
        if (this.suppressOutput || (rid && this.qwenSuppressedResponseIds.has(rid))) return;
        const delta = msg.delta || '';
        if (delta) {
          this.ttsActive = true;
          this.turnHadAudio = true;
          const audioBuffer = Buffer.from(delta, 'base64');
          this.emit('agent_audio_chunk', {
            buffer: audioBuffer,
            audioBase64: delta,
            sampleRate: 24000,
            turnId: this.activeTurnId,
          });
        }
        break;
      }

      case 'response.text.delta':
      case 'response.audio_transcript.delta': {
        const responseId = String(msg.response_id || this.activeTurnId || 'qwen_resp');
        if (this.suppressOutput || this.qwenSuppressedResponseIds.has(responseId)) return;
        const family = type.startsWith('response.audio_transcript') ? 'audio_transcript' : 'text';
        const chunks = this.arbitrateQwenTextDelta(responseId, family, String(msg.delta || ''));
        for (const text of chunks) {
          // aiAcc mirrors the arbitrated accumulation so fullText stays the
          // single authoritative transcript for the renderer.
          this.aiAcc = appendAssistantDelta(this.aiAcc, text);
          this.emit('agent_text_delta', { delta: text, fullText: this.aiAcc, turnId: this.activeTurnId });
        }
        break;
      }

      case 'response.audio_transcript.done':
      case 'response.output_text.done': {
        const rid = String(msg.response_id || this.activeTurnId || '');
        if (this.suppressOutput || (rid && this.qwenSuppressedResponseIds.has(rid))) return;
        const finalText = String(msg.transcript || msg.text || '').trim();
        // A done frame is also sent for canceled or incomplete responses.
        // An empty transcript is not a correction to already spoken text! (VoiceSpirit 96aa957)
        if (!finalText) {
          return;
        }
        break;
      }

      case 'response.done': {
        const rid = String(msg.response?.id || this.activeTurnId || '');
        const doneStatus = String(msg.response?.status || '');
        const isInterruptedOrSuppressed =
          this.suppressOutput ||
          (rid && this.qwenSuppressedResponseIds.has(rid)) ||
          doneStatus === 'cancelled' ||
          doneStatus === 'canceled' ||
          doneStatus === 'failed';

        if (isInterruptedOrSuppressed) {
          // A barge-in-cancelled reply still sends its own done (standard
          // behaviour). It must neither settle its held fragment nor fire a
          // completion for speech that was suppressed — and it must not lift
          // the suppression while the barge-in is still active.
          delete this.qwenFamilyState[rid];
          if (rid) this.qwenSuppressedResponseIds.add(rid);
          if (this.qwenSuppressedResponseIds.size > 20) {
            const first = this.qwenSuppressedResponseIds.values().next().value;
            this.qwenSuppressedResponseIds.delete(first);
          }
          return;
        }

        // If exactly one audio_transcript delta arrived it is still HELD
        // awaiting a text claim that never came — force-settle it so the
        // reply does not lose its opening words (VoiceSpirit
        // _emit_held_family_delta).
        const fstate = this.qwenFamilyState[rid];
        if (fstate && !fstate.decided && fstate.heldAudio) {
          const held = fstate.heldAudio.replace(/^\s+/, '');
          fstate.heldAudio = '';
          if (held) {
            fstate.decided = 'audio_transcript';
            fstate.accumulatedText = held;
            this.aiAcc = appendAssistantDelta(this.aiAcc, held);
            this.emit('agent_text_delta', { delta: held, fullText: this.aiAcc, turnId: this.activeTurnId });
          }
        }
        delete this.qwenFamilyState[rid];
        this.suppressOutput = false;
        this.ttsActive = false;
        this.emit('agent_complete', { text: this.aiAcc, response: msg.response, turnId: this.activeTurnId, hadAudio: this.turnHadAudio });
        this.aiAcc = '';
        this.turnHadAudio = false;
        this.activeTurnId = null;
        this.activeResponseId = null;
        break;
      }

      case 'error': {
        const errObj = msg.error || msg;
        const errMsg = typeof errObj === 'object' ? (errObj.message || JSON.stringify(errObj)) : String(errObj);
        const isBenign = QWEN_AUDIO_BENIGN_ERROR_PATTERNS.some((pat) => errMsg.includes(pat));
        if (isBenign) {
          console.log(`[CloudVoiceEngine] Qwen benign server race ignored: ${errMsg}`);
          return;
        }
        console.warn('[CloudVoiceEngine] Qwen event error:', errMsg);
        this.emit('status', { status: 'error', error: errMsg, provider: '阿里千问 (DashScope Realtime)' });
        break;
      }

      default:
        break;
    }
  }

  // ------------------------------------------------------------------
  // Provider 4: Google Gemini Live — 实时对话 (chat) & 实时翻译 (live translate)
  // Ported from VoiceSpirit backend/services/realtime_google_provider.py.
  // One BidiGenerateContent WebSocket carries both modes:
  //   'google'           → gemini-3.1-flash-live-preview, hero persona + server VAD
  //   'google-translate' → gemini-3.5-live-translate-preview, translationConfig only
  // Wire notes: input/output transcription configs (and translationConfig /
  // realtimeInputConfig) are TOP-LEVEL setup fields; responseModalities and
  // speechConfig live inside generationConfig. Both transcription streams are
  // cumulative-with-overlap → merged through streamingNovelty (same shape as
  // DashScope LiveTranslate).
  // ------------------------------------------------------------------
  async connectGoogleLive() {
    // Connect generation: connectGoogleLive awaits proxy resolution before
    // creating the socket, so a rapid provider switch / hero reconnect could
    // otherwise leave a second socket racing the first. A stale generation
    // aborts silently and destroys any tunnel it already opened.
    const connectGen = (this.googleConnectGen = (this.googleConnectGen || 0) + 1);
    const stale = () => connectGen !== this.googleConnectGen;
    loadEnv();
    const apiKey = this.apiKey || CLOUD_KEYS.gemini;
    if (!apiKey) {
      this.emit('status', {
        status: 'error',
        error: 'Google 密钥未配置，请打开 AI 设置。',
        provider: '谷歌 Gemini Live',
      });
      return;
    }

    const isTranslate = this.provider === 'google-translate';
    this.isGoogleTranslateSession = isTranslate;
    this.isConnecting = true;
    this.suppressReconnect = false;
    this.resetGoogleLiveState();
    this.emit('status', {
      status: 'connecting',
      providerId: isTranslate ? 'google-translate' : 'google',
      provider: isTranslate ? '谷歌实时翻译 (Gemini Live Translate)' : '谷歌实时对话 (Gemini Live)',
    });

    const wsUrl = CLOUD_KEYS.google_ws_url || GOOGLE_LIVE_WS_URL;

    // Proxy resolution: plain ws() ignores the system proxy, so for wss
    // targets we pre-establish an HTTP CONNECT tunnel and hand ws the
    // already-tunneled socket. localhost/mock targets always go direct, and
    // a dead proxy candidate falls back to direct instead of stalling.
    let wsOptions = {
      headers: {
        'x-goog-api-key': apiKey,
        'user-agent': 'VoiceSpirit/Dota2Companion-GoogleLive',
      },
    };
    try {
      const target = new URL(wsUrl);
      const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname);
      if (target.protocol === 'wss:' && !isLocal) {
        for (const proxy of await resolveGoogleProxyCandidates()) {
          if (stale()) return;
          let tunnel = null;
          try {
            tunnel = await establishHttpTunnel(proxy, target.hostname, 443);
            if (stale()) {
              try { tunnel.destroy(); } catch (e) {}
              return;
            }
            wsOptions.createConnection = () =>
              tls.connect({ socket: tunnel, servername: target.hostname });
            console.log(`[CloudVoiceEngine] Google Live routing via proxy ${proxy.host}:${proxy.port}`);
            break;
          } catch (err) {
            console.warn(`[CloudVoiceEngine] Proxy ${proxy.host}:${proxy.port} failed, trying next/direct:`, err.message);
          }
        }
      }
    } catch (e) {
      console.warn('[CloudVoiceEngine] Proxy resolution skipped:', e.message);
    }
    if (stale()) return;

    try {
      const socket = new WebSocket(wsUrl, wsOptions);
      this.ws = socket;
      if (stale()) {
        try { socket.close(); } catch (e) {}
        return;
      }

      socket.on('open', () => {
        if (this.ws !== socket) return;
        // BidiGenerateContent requires the setup as the VERY FIRST frame.
        try {
          socket.send(this.buildGoogleSetupMessage());
        } catch (e) {
          console.error('[CloudVoiceEngine] Failed to send Google setup:', e);
        }
      });

      socket.on('message', (data) => {
        if (this.ws !== socket) return;
        try {
          const raw = typeof data === 'string' ? data : data.toString('utf-8');
          const event = JSON.parse(raw);
          this.handleGoogleLiveEvent(event);
        } catch (e) {
          console.error('[CloudVoiceEngine] Error parsing Google Live event:', e);
        }
      });

      socket.on('error', (err) => {
        if (this.ws !== socket) return;
        const msg = String(err?.message || err);
        console.warn('[CloudVoiceEngine] Google Live WS error:', msg);
        if (msg.includes('401') || msg.includes('403') || msg.includes('API key')) {
          this.isConnected = false;
          this.isConnecting = false;
          this.emit('status', {
            status: 'error',
            error: `谷歌 Gemini Live 鉴权失败 (${msg})。请检查 google_api_key 是否有效。`,
            provider: '谷歌 Gemini Live',
          });
          return;
        }
        this.emit('status', { status: 'error', error: msg, provider: '谷歌 Gemini Live' });
      });

      socket.on('close', (code, reason) => {
        if (this.ws !== socket) return;
        this.stopGoogleTranslateMonitor();
        const reasonStr = reason ? reason.toString() : '';
        console.log(`[CloudVoiceEngine] Google Live WS closed: code=${code}, reason=${reasonStr}`);

        // Surface the rejection for this key; retry is an explicit user action.
        this.isConnected = false;
        this.isConnecting = false;
        if (code === 1008 || /401|403|api.?key|unauthenticated|quota|resource.?exhausted/i.test(reasonStr)) {
          this.emit('status', {
            status: 'error',
            error: `谷歌 Gemini Live 会话被服务端关闭: ${reasonStr || code}。请检查 google_api_key / 网络。`,
            provider: '谷歌 Gemini Live',
          });
          return;
        }
        this.scheduleReconnect();
      });
    } catch (err) {
      console.error('[CloudVoiceEngine] Failed to init Google Live WS:', err);
      this.emit('status', { status: 'error', error: err.message, provider: '谷歌 Gemini Live' });
    }
  }

  /**
   * Build the BidiGenerateContentSetup frame. Live Translate accepts ONLY
   * translationConfig (+ transcription configs): systemInstruction /
   * speechConfig / VAD overrides are unsupported — input language is
   * auto-detected and translated into translateTargetLanguage (tray
   * selectable, default 'en'). echoTargetLanguage stays false (official
   * default): echoing input that is already the target language would make
   * the model parrot the speaker instead of translating.
   */
  buildGoogleSetupMessage() {
    const isTranslate = this.provider === 'google-translate';
    // Newest-generation models only (no legacy fallbacks by design):
    //   chat      → gemini-3.1-flash-live-preview
    //   translate → gemini-3.5-live-translate-preview
    const model = isTranslate ? (this.googleTranslateModel || DEFAULT_GOOGLE_LIVE_TRANSLATE_MODEL) : (this.googleModel || DEFAULT_GOOGLE_REALTIME_MODEL);
    this.googleActiveModel = model;

    const setup = { model: `models/${model}` };
    if (isTranslate) {
      // Wire shape verified against the google-genai SDK converter
      // (_LiveConnectConfig_to_mldev): translationConfig rides INSIDE
      // generationConfig; transcription configs are setup-level.
      setup.generationConfig = {
        responseModalities: ['AUDIO'],
        translationConfig: {
          targetLanguageCode: this.translateTargetLanguage || 'en',
          echoTargetLanguage: this.translateEcho === true,
        },
      };
      setup.inputAudioTranscription = {};
      setup.outputAudioTranscription = {};
    } else {
      setup.generationConfig = {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: this.googleVoice || DEFAULT_GOOGLE_REALTIME_VOICE },
          },
        },
      };
      setup.inputAudioTranscription = {};
      setup.outputAudioTranscription = {};
      // Server VAD, HIGH sensitivity both ends; default activityHandling keeps
      // native barge-in enabled (user speech interrupts model audio), matching
      // the Doubao duplex UX.
      setup.realtimeInputConfig = {
        automaticActivityDetection: {
          disabled: false,
          startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
          endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
          prefixPaddingMs: 500,
          silenceDurationMs: 1500,
        },
      };
      setup.systemInstruction = { parts: [{ text: this.getHeroSystemPrompt() }] };
    }
    return JSON.stringify({ setup });
  }

  markGoogleActivity() {
    this.googleLastActivityMs = Date.now();
    this.googleTranslateHasContent = true;
  }

  handleGoogleLiveEvent(event) {
    if (!event) return;

    if (event.setupComplete !== undefined) {
      this.isConnected = true;
      this.isConnecting = false;
      this.sessionId = generateEventId('sess_google');
      console.log(`[CloudVoiceEngine] Google Live setupComplete (${this.googleActiveModel}, mode=${this.provider})`);
      this.emit('status', {
        status: 'connected',
        providerId: this.isGoogleTranslateSession ? 'google-translate' : 'google',
        provider: this.isGoogleTranslateSession
          ? '谷歌实时翻译 (Gemini Live Translate)'
          : '谷歌实时对话 (Gemini Live)',
      });
      this.emit('session_ready', { sessionId: this.sessionId, provider: 'Google' });
      if (this.isGoogleTranslateSession) {
        this.startGoogleTranslateMonitor();
      }
      return;
    }

    if (event.error) {
      const errObj = event.error;
      const errMsg = typeof errObj === 'object' ? (errObj.message || JSON.stringify(errObj)) : String(errObj);
      console.warn('[CloudVoiceEngine] Google Live error event:', errMsg);
      this.emit('status', { status: 'error', error: errMsg, provider: '谷歌 Gemini Live' });
      return;
    }

    const serverContent = event.serverContent;
    if (!serverContent) return;

    // Native barge-in: the server has CUT the current model turn, so no
    // suppression window is needed — anything arriving after this frame is
    // the next reply. Clear local accumulators so the dying reply's partial
    // text/audio can't glue onto it. (A client-initiated interrupt() DOES
    // arm googleSuppress, since the server keeps streaming in that case.)
    if (serverContent.interrupted && !this.isGoogleTranslateSession) {
      this.googleAiAcc = '';
      this.googleAudioStarted = false;
      this.ttsActive = false;
      this.emit('interrupted', { interrupted: true });
    }

    // ---- Model audio (PCM 24 kHz inline chunks). ----
    // Processed BEFORE the transcription blocks: a finished marker in the
    // SAME frame finalizes the translate turn immediately, and finalize must
    // see this frame's audio in googleAudioStarted or hadAudio would be
    // reported false on an audible turn.
    if (!this.googleSuppress) {
      const parts = serverContent.modelTurn?.parts || [];
      for (const part of parts) {
        const inline = part?.inlineData || part?.inline_data;
        const b64 = String(inline?.data || '');
        if (!b64) continue;
        const mime = String(inline?.mimeType || inline?.mime_type || 'audio/pcm;rate=24000');
        const rateMatch = mime.match(/rate=(\d+)/);
        if (!this.googleAudioStarted) {
          this.googleAudioStarted = true;
          this.ttsActive = true;
          this.activeTurnId = generateEventId('gturn');
          this.emit('agent_audio_start', { responseId: this.activeTurnId });
        }
        const buffer = Buffer.from(b64, 'base64');
        this.emit('agent_audio_chunk', {
          buffer,
          audioBase64: b64,
          sampleRate: rateMatch ? parseInt(rateMatch[1], 10) : 24000,
          turnId: this.activeTurnId,
        });
      }
    }

    // ---- Input transcription (user speech). Cumulative-with-overlap. ----
    const inputTrans = serverContent.inputTranscription || serverContent.input_audio_transcription;
    const inputText = String(inputTrans?.text || '');
    if (inputText) {
      this.markGoogleActivity();
      const { merged, novel } = streamingNovelty(this.googleUserAcc, inputText);
      this.googleUserAcc = merged;
      this.googleUserAccHasContent = Boolean(merged.trim());
      if (merged.trim()) {
        this.emit('speech_interim', merged);
      }
      if (inputTrans?.finished === true) {
        if (this.isGoogleTranslateSession) {
          this.googleTranslateInputFinished = true;
          this.finalizeGoogleLiveTranslateTurn(false);
        } else {
          this.finalizeGoogleUserTranscript();
        }
      }
    }

    // ---- Output transcription (model speech / translated speech). ----
    const outputTrans = serverContent.outputTranscription || serverContent.output_audio_transcription;
    const outputText = String(outputTrans?.text || '');
    if (outputText && !this.googleSuppress) {
      this.markGoogleActivity();
      const { merged, novel } = streamingNovelty(this.googleAiAcc, outputText);
      this.googleAiAcc = merged;
      if (novel) {
        this.emit('agent_text_delta', { delta: novel, fullText: merged, turnId: this.activeTurnId });
      }
      if (outputTrans?.finished === true && this.isGoogleTranslateSession) {
        this.googleTranslateOutputFinished = true;
        this.finalizeGoogleLiveTranslateTurn(false);
      }
    } else if (outputText) {
      // Suppressed residue still advances the translate-turn activity clock
      // and honours its finished markers, it just never reaches the player.
      this.markGoogleActivity();
      if (outputTrans?.finished === true && this.isGoogleTranslateSession) {
        this.googleTranslateOutputFinished = true;
      }
    }

    if (serverContent.turnComplete) {
      this.googleSuppress = false;
      this.suppressOutput = false;
      if (this.isGoogleTranslateSession) {
        this.finalizeGoogleLiveTranslateTurn(true);
      } else {
        this.finalizeGoogleUserTranscript();
        this.finalizeGoogleAssistantTurn();
      }
    }
  }

  finalizeGoogleUserTranscript() {
    const text = this.googleUserAcc.trim();
    this.googleUserAcc = '';
    this.googleUserAccHasContent = false;
    if (text) {
      this.emit('speech_final', text);
    }
  }

  finalizeGoogleAssistantTurn() {
    this.ttsActive = false;
    // Captured BEFORE the reset: the renderer's local-TTS fallback keys off
    // this flag, and the echo/late user-final emitted right before this
    // complete must not make it re-read audio the model already spoke.
    const hadAudio = this.googleAudioStarted;
    this.googleAudioStarted = false;
    const text = this.googleAiAcc;
    this.googleAiAcc = '';
    this.emit('agent_complete', { text, turnId: this.activeTurnId, hadAudio });
    this.activeTurnId = null;
  }

  /**
   * Live Translate has no VAD/turn model: a turn closes when BOTH the input
   * and output transcription streams carry a finished marker, or — ported
   * from VoiceSpirit's inactivity monitor — when 2s pass without any
   * downstream content while a turn has pending text.
   */
  finalizeGoogleLiveTranslateTurn(force) {
    if (!this.isGoogleTranslateSession || !this.googleTranslateHasContent) return;
    const streamsSettled =
      this.googleTranslateInputFinished && this.googleTranslateOutputFinished;
    if (!force && !streamsSettled) return;

    this.finalizeGoogleUserTranscript();
    const text = this.googleAiAcc;
    this.googleAiAcc = '';
    // Captured BEFORE the reset: the live-translate model is audio-out by
    // design (speaker's own voice), so a normal turn DELIVERS audio. Reporting
    // hadAudio:false unconditionally made the renderer's local-TTS fallback
    // re-read every translation over the cloud audio.
    const hadAudio = this.googleAudioStarted;
    this.googleAudioStarted = false;
    this.ttsActive = false;
    this.googleSuppress = false;
    this.googleTranslateHasContent = false;
    this.googleTranslateInputFinished = false;
    this.googleTranslateOutputFinished = false;
    this.googleLastActivityMs = 0;
    this.emit('agent_complete', { text, turnId: this.activeTurnId, mode: 'live_translate', hadAudio });
    this.activeTurnId = null;
  }

  /**
   * Client VAD — the turn mechanism of the flash-live chat generation: RMS-
   * track outgoing PCM and, once trailing silence follows actual speech,
   * commit the utterance with realtimeInput.audioStreamEnd (see
   * GOOGLE_CLIENT_VAD_* constants).
   */
  trackGoogleClientVad(buffer) {
    const samples = Math.floor(buffer.length / 2);
    if (samples <= 0) return;
    const int16 = new Int16Array(buffer.buffer, buffer.byteOffset, samples);
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      sum += int16[i] * int16[i];
    }
    const rms = Math.sqrt(sum / samples);
    const durationMs = samples / 16; // 16 kHz → samples/16 == ms
    if (rms >= GOOGLE_CLIENT_VAD_RMS_THRESHOLD) {
      this.googleSawSpeech = true;
      this.googleSilenceMs = 0;
      return;
    }
    if (!this.googleSawSpeech) return;
    this.googleSilenceMs += durationMs;
    if (this.googleSilenceMs >= GOOGLE_CLIENT_VAD_SILENCE_MS) {
      this.commitGoogleUtterance();
    }
  }

  /**
   * Explicitly commit the in-flight utterance (audioStreamEnd). Called by the
   * client-VAD silence timer and by the renderer when the microphone is
   * switched off with speech still pending.
   */
  commitGoogleUtterance() {
    this.googleSawSpeech = false;
    this.googleSilenceMs = 0;
    if (this.provider !== 'google' || !this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      console.log('[CloudVoiceEngine] Google client-VAD: utterance committed (audioStreamEnd)');
    } catch (e) {}
  }

  sendSessionUpdate() {
    if (!this.isConnected && !(this.isConnecting && ['qwen', 'dashscope'].includes(this.provider))) return;

    if (this.provider === 'doubao') {
      this.sendDoubaoSessionCreate();
      return;
    }

    if (this.provider === 'qwen' || this.provider === 'dashscope') {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const sessionConfig = {
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          voice: this.voice || process.env.DASHSCOPE_REALTIME_VOICE || DEFAULT_DASHSCOPE_REALTIME_VOICE,
          instructions: this.getHeroSystemPrompt('bilingual'),
          input_audio_format: 'pcm',
          output_audio_format: 'pcm',
          turn_detection: {
            ...DEFAULT_QWEN_OMNI_TURN_DETECTION,
          },
          max_history_turns: 20,
        },
      };
      try {
        this.ws.send(JSON.stringify(sessionConfig));
      } catch (err) {
        console.error('[CloudVoiceEngine] Failed to send Qwen session update:', err);
      }
    }
  }

  /**
   * Barge-in interruption
   */
  interrupt() {
    // Capture what was playing BEFORE zeroing ttsActive, otherwise the
    // "is there anything to cancel?" check below sees only its own clearing.
    const wasPlaying = this.ttsActive || Boolean(this.activeResponseId);
    this.suppressOutput = true;
    this.ttsActive = false;
    if (this.provider === 'doubao') {
      // Arm the same targeted residue window an ASR-started barge-in uses:
      // the doubao downlink gates on response identity, so a blanket flag
      // alone would let the cancelled reply's remaining chunks through.
      // Only when there is actually something to cancel — arming while idle
      // would blank-suppress the NEXT legitimate reply's opening text until
      // its own started event arrives.
      if (wasPlaying) {
        this.suppressedResponseId = this.activeResponseId || '';
        this.turnFinalized = false;
      }
    }
    if (this.provider === 'google' || this.provider === 'google-translate') {
      // The Live API has no client-side cancel primitive: blank the local
      // player and suppress the dying turn's downstream residue until the
      // server's turnComplete (or the translate idle finalizer) lifts it.
      // Arm ONLY when something is actually playing — translate sessions
      // never receive turnComplete, so a blanket window here would eat the
      // NEXT turn's translated text until its own idle finalize (same
      // reasoning as the Doubao suppressedResponseId guard above).
      if (wasPlaying) {
        this.googleSuppress = true;
        this.googleAiAcc = '';
        this.googleAudioStarted = false;
      }
    }
    this.emit('interrupted', { interrupted: true });

    if (this.provider === 'cartesia' || this.provider === 'cloud-stream') {
      this.interruptCartesia();
      return;
    }

    if (this.provider === 'qwen' || this.provider === 'dashscope') {
      if (wasPlaying) {
        const activeId = String(this.activeTurnId || this.activeResponseId || '');
        if (activeId) {
          this.qwenSuppressedResponseIds.add(activeId);
        }
      }
      this.activeTurnId = null;
      this.activeResponseId = null;
      this.qwenFamilyState = {};
      this.aiAcc = '';
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'response.cancel' }));
        } catch (e) {}
      }
    }
  }

  sendAudioChunk(chunk) {
    if (!this.isConnected) return;

    // 1. Cartesia Ink-2 STT WebSocket
    if (this.provider === 'cartesia' || this.provider === 'cloud-stream' || this.provider === 'cartesia-deepseek') {
      if (this.cartesiaSttWs && this.cartesiaSttWs.readyState === WebSocket.OPEN) {
        let binaryBuffer = null;
        if (Buffer.isBuffer(chunk)) {
          binaryBuffer = chunk;
        } else if (chunk instanceof ArrayBuffer) {
          binaryBuffer = Buffer.from(chunk);
        } else if (chunk?.buffer && chunk.buffer instanceof ArrayBuffer) {
          binaryBuffer = Buffer.from(chunk.buffer, chunk.byteOffset || 0, chunk.byteLength || chunk.length);
        } else if (typeof chunk === 'string') {
          binaryBuffer = Buffer.from(chunk, 'base64');
        }
        if (binaryBuffer && binaryBuffer.length > 0) {
          try {
            this.cartesiaSttWs.send(binaryBuffer);
          } catch (err) {
            console.error('[CloudVoiceEngine] Cartesia STT send error:', err);
          }
        }
      }
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    let base64Audio = '';
    if (Buffer.isBuffer(chunk)) {
      base64Audio = chunk.toString('base64');
    } else if (chunk instanceof ArrayBuffer) {
      base64Audio = Buffer.from(chunk).toString('base64');
    } else if (chunk?.buffer && chunk.buffer instanceof ArrayBuffer) {
      base64Audio = Buffer.from(chunk.buffer, chunk.byteOffset || 0, chunk.byteLength || chunk.length).toString('base64');
    } else if (typeof chunk === 'string') {
      base64Audio = chunk;
    }

    if (!base64Audio) return;

    // 2. Doubao Duplex, 3. Qwen Realtime and 4. Google Live share a JSON
    // audio frame (Google's is a realtimeInput blob instead of a buffer append).
    if (this.provider === 'doubao' || this.provider === 'qwen' || this.provider === 'dashscope') {
      try {
        this.ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64Audio,
        }));
      } catch (err) {
        console.error(`[CloudVoiceEngine] ${this.provider} audio chunk error:`, err);
      }
      return;
    }

    if (this.provider === 'google' || this.provider === 'google-translate') {
      try {
        this.ws.send(JSON.stringify({
          realtimeInput: {
            audio: { mimeType: 'audio/pcm;rate=16000', data: base64Audio },
          },
        }));
        // The flash-live chat generation commits turns client-side.
        if (this.provider === 'google') {
          this.trackGoogleClientVad(Buffer.from(base64Audio, 'base64'));
        }
      } catch (err) {
        console.error(`[CloudVoiceEngine] ${this.provider} audio chunk error:`, err);
      }
    }
  }

  async sendUserText(text) {
    if (!text || !text.trim()) return;
    if (!this.isConnected) {
      this.emit('status', { status: 'error', providerId: this.provider, error: '连接已断开，请手动重试。' });
      return;
    }
    const trimmed = text.trim();

    const lang = detectPrimaryLanguage(trimmed);
    this.adaptVoiceForLanguage(lang);

    this.emit('speech_final', trimmed);

    // 1. Cartesia + DeepSeek-Flash Pipeline
    if (this.provider === 'cartesia' || this.provider === 'cloud-stream' || this.provider === 'cartesia-deepseek') {
      await this.startCartesiaTurn(trimmed);
      return;
    }

    // 2. Doubao Duplex: text goes into conversation context
    if (this.provider === 'doubao' && this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          type: 'conversation.item.create',
          event_id: generateEventId('item_create'),
          items: [{
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: trimmed }],
          }],
        }));
      } catch (e) {
        console.warn('[CloudVoiceEngine] Doubao text context send error:', e);
      }
      return;
    }

    // 3. Qwen Realtime WebSocket
    if ((this.provider === 'qwen' || this.provider === 'dashscope') && this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: trimmed }],
          },
        }));
        this.ws.send(JSON.stringify({ type: 'response.create' }));
        return;
      } catch (e) {
        console.warn('[CloudVoiceEngine] Qwen text send failed');
      }
    }

    // 4. Google Gemini Live
    if (this.provider === 'google' || this.provider === 'google-translate') {
      if (this.provider === 'google-translate') {
        // Live Translate is audio-only: no systemInstruction, no text turns.
        this.emit('status', {
          status: 'error',
          error: '谷歌实时翻译 (Live Translate) 仅支持实时语音输入，不支持文本输入。',
          provider: '谷歌 Gemini Live',
        });
        return;
      }
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({
            clientContent: {
              turns: [{ role: 'user', parts: [{ text: trimmed }] }],
              turnComplete: true,
            },
          }));
          return;
        } catch (e) {
          console.warn('[CloudVoiceEngine] Google clientContent send failed:', e);
        }
      }
    }

    this.emit('status', { status: 'error', providerId: this.provider, error: '连接已断开，请手动重试。' });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          if (this.ws.ping) {
            this.ws.ping();
          }
        } catch (e) {}
      }
    }, 20000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  scheduleReconnect() {
    if (!this.autoReconnect) {
      if (!this.suppressReconnect) this.emit('status', { status: 'error', providerId: this.provider, error: '连接已断开，请手动重试。' });
      return;
    }
    // Never stack timers, never reconnect behind a live session, and never
    // reconnect an intentional disconnect() (app quit / provider switch).
    if (this.reconnectTimer || this.isConnected || this.suppressReconnect) return;
    // Announce the dead session BEFORE the backoff window, or the renderer's
    // mic gate keeps trusting a socket that is already gone. providerId is
    // normalized to the canonical tray id — legacy aliases (dashscope,
    // cloud-stream…) have no radio of their own.
    const providerId = (this.provider === 'dashscope' || this.provider === 'dashscope-ws')
      ? 'qwen'
      : (this.provider === 'cloud-stream' || this.provider === 'cartesia-deepseek')
        ? 'cartesia'
        : this.provider;
    this.emit('status', { status: 'connecting', providerId, provider: '重连中…' });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  disconnect() {
    this.suppressReconnect = true;
    this.stopHeartbeat();
    // Invalidate any connectGoogleLive() still awaiting proxy resolution so
    // it cannot open a socket behind this disconnect.
    this.googleConnectGen = (this.googleConnectGen || 0) + 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Clean Cartesia STT / TTS WebSockets
    if (this.cartesiaAbortController) {
      try { this.cartesiaAbortController.abort(); } catch (e) {}
      this.cartesiaAbortController = null;
    }
    if (this.cartesiaSttWs) {
      try { this.cartesiaSttWs.close(); } catch (e) {}
      this.cartesiaSttWs = null;
    }
    if (this.cartesiaTtsWs) {
      try { this.cartesiaTtsWs.close(); } catch (e) {}
      this.cartesiaTtsWs = null;
    }
    this.cartesiaIsSttOpen = false;
    this.cartesiaIsTtsOpen = false;

    // Clean Doubao / Qwen WebSocket
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN && this.provider === 'doubao') {
        try {
          this.ws.send(JSON.stringify({
            type: 'session.close',
            event_id: generateEventId('sess_close'),
          }));
        } catch (e) {}
      }
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
    // Drop every per-stream accumulator so a reconnect can never inherit
    // suppression windows or partial transcripts from the dead session.
    this.resetTranscriptState();
  }
}
