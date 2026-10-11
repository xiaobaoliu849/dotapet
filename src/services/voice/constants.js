/** Provider defaults and the credentials the main process hands the voice engine. */

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

// Pseudo-hero id that unlocks Free-Chat Companion mode (see getHeroSystemPrompt):
// casual chatting by default, with model-side smart routing into any hero's
// persona when the summoner addresses one.
export const FREE_CHAT_HERO_ID = 'companion';
export const FREE_CHAT_HERO_IDS = new Set([FREE_CHAT_HERO_ID]);

// Language-Aware Female Voice Mappings (Female Only for pure natural gaming coach experience)
// Doubao is intentionally absent: its en_* voices are English-only, so dynamic
// switching there breaks Chinese TTS — the voice stays pinned to xiaohe.
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
//   provider 'google'            → 实时对话  gemini-3.8-live (hero persona, VAD barge-in)
//   provider 'google-translate'  → 实时翻译  gemini-3.5-live-translate-preview (translationConfig only)
export const GOOGLE_LIVE_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export const DEFAULT_GOOGLE_REALTIME_MODEL = 'gemini-3.8-live';
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
// A session restarted to apply a new persona or language must be back by then, or the call ends.
export const RESTART_TIMEOUT_MS = 15000;
// Keep the client-side end-of-speech flush alongside automatic server VAD.
// The official Live API supports audioStreamEnd with automatic VAD enabled;
// it flushes cached audio and subsequent audio reopens the stream. This also
// retains the workaround needed by the former 3.1 preview. Live Translate
// is continuous and is excluded from this chat-only flush.
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
