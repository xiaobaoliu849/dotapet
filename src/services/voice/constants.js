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

// MOSS-Live (MOSI) Full-Duplex Realtime Constants (ported from VoiceSpirit
// realtime_moss_provider.py + realtime_constants.py + MOSS Voice Library).
// Docs: platform.moss.cn/en/docs/reference/moss-live
export const DEFAULT_MOSS_REALTIME_WS_URL = 'wss://api.mosi.cn/v1/realtime';
export const DEFAULT_MOSS_REALTIME_MODEL = 'moss-live-1.0';
export const MOSS_INPUT_SAMPLE_RATE = 16000;
export const MOSS_OUTPUT_SAMPLE_RATE = 48000;
export const MOSS_INPUT_FRAME_BYTES = 640; // 20 ms of 16 kHz mono S16LE
export const MOSS_PLAYBACK_LEAD_SECONDS = 0.15;

// Curated Native English (US/UK) & Native Chinese voices from MOSS Voice Library:
// Passed via `{"action": "change_voice", "voice_name": "<id>"}` after `session_attached`.
export const DEFAULT_MOSS_ENGLISH_VOICE = '0f2815fb-0d4c-4cee-ac8c-0bb916af7b28'; // 女7 · 美式英语
export const DEFAULT_MOSS_CHINESE_VOICE = '42161c92-b6ad-4d12-a51e-48506ecfad82'; // 豆包 · 中文普通话温柔播客
export const DEFAULT_MOSS_REALTIME_VOICE = DEFAULT_MOSS_ENGLISH_VOICE;
export const DEFAULT_MOSS_REALTIME_ACCENT = DEFAULT_MOSS_REALTIME_VOICE;

export const MOSS_VOICE_CATALOG = Object.freeze({
  // Native English (US & UK)
  '0f2815fb-0d4c-4cee-ac8c-0bb916af7b28': { lang: 'en', accent: 'en-US', label: '女7 · Native US 美式英语女声' },
  'b4b5f9c4-2829-4cfd-96f2-7fddaf8450bb': { lang: 'en', accent: 'en-US', label: '自定义2 · Native US 美音游戏活力女声' },
  '29ab8244-1319-40d4-b508-2b58bb5e2d81': { lang: 'en', accent: 'en-GB', label: 'Amber · Native UK 英式专业女声' },
  'ad8f9ced-3276-42f1-a2ca-a686c7d5e01d': { lang: 'en', accent: 'en-GB', label: 'Chenlin · Native UK 英式教育女声' },
  '2792e95d-357f-4064-aee7-2bb514aa0d06': { lang: 'en', accent: 'en-US', label: '女6 · Native US 美式英语女声' },
  'c4f93733-9d7f-43cf-997f-e080347022e4': { lang: 'en', accent: 'en-US', label: '女5 · Native US 美式英语女声' },
  '38264a7d-63d1-4f6b-b2e7-7035d480bb65': { lang: 'en', accent: 'en-US', label: '女4 · Native US 美式英语女声' },
  // Native Chinese (Mandarin / Beijing / Sichuan)
  '42161c92-b6ad-4d12-a51e-48506ecfad82': { lang: 'zh', accent: 'zh-CN', label: '豆包 · Native CN 中文温柔播客女声' },
  '6c3152b1-1d4f-4e49-ade3-09f447712fec': { lang: 'zh', accent: 'zh-CN', label: 'Nuannuan · 暖暖 中文温柔女声' },
  'ddfec779-cdf6-47d2-bcde-222865e2e834': { lang: 'zh', accent: 'zh-CN', label: '女主-顾 · Native CN 清凉微凉女声' },
  '7ea0bc93-fbeb-44fe-9702-7aa2024199a3': { lang: 'zh', accent: 'zh-CN', label: '测试2 · Native CN 动漫甜美磁性女声' },
  'b8943b5a-478b-4281-9186-dfb6db79bc7a': { lang: 'zh', accent: 'zh-Beijing', label: '珀绎 · Native CN 北京口音磁性女声' },
  '7ad63513-bdce-40d0-9d66-94dbdef7073b': { lang: 'zh', accent: 'zh-Sichuan', label: '瑶族 · Native CN 四川口音轻快女声' },
  'db47bbad-32eb-4e08-b615-f6244a2a9e7a': { lang: 'zh', accent: 'zh-CN', label: '女2 · Native CN 中文播客女声' },
  '58e3dd68-a528-4519-8f88-a616b9448b68': { lang: 'zh', accent: 'zh-CN', label: 'yisa2 · Native CN 中文播客女声' },
  '6cc93520-3207-4f7a-bca9-2d560b9c306b': { lang: 'zh', accent: 'zh-CN', label: 'Mumu · 沐沐 中文自然男声' },
  default: { lang: 'zh', accent: 'zh-CN', label: 'Default · 默认原生中文音色' },
});

export const MOSS_REALTIME_VOICES = Object.keys(MOSS_VOICE_CATALOG);
export const MOSS_REALTIME_ACCENTS = MOSS_REALTIME_VOICES;

// Every provider id the engine accepts, legacy aliases included, by the module that runs it.
export const PROVIDER_FAMILIES = Object.freeze({
  cartesia: 'cartesia', 'cloud-stream': 'cartesia', 'cartesia-deepseek': 'cartesia',
  doubao: 'doubao',
  qwen: 'qwen', dashscope: 'qwen', 'dashscope-ws': 'qwen',
  google: 'google', 'google-translate': 'google',
  moss: 'moss', 'moss-live': 'moss',
});

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
  moss_api_key: '',
  moss_ws_url: '',
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
