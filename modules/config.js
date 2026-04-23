import { HarmBlockThreshold, HarmCategory } from '@google/genai';

// ============================================================================
// BOT IDENTITY
// ============================================================================

export const BOT_CONFIG = Object.freeze({
  DEFAULT_RESPONSE_FORMAT: 'Normal',
  HEX_COLOUR:  '#5B7C99', // Soft Nordic blue — global embed color fallback
  WORK_IN_DMS: true
});

// ============================================================================
// GEMMA / AI ROUTING
// ENABLE_GEMMA routes ALL standard chat through GEMMA_DEFAULT_MODEL globally.
// Slash commands needing incompatible tools (/search, /summary) bypass this.
// ============================================================================

export const ENABLE_GEMMA            = true;
export const GEMMA_DEFAULT_MODEL     = 'gemma-4-26b';  // key in MODELS map below
export const GEMMA_FALLBACK_MODEL    = 'gemma-4-31b';  // key in MODELS map below
export const CYCLE_GEMMA_WITH_GEMINI = false;          // append Gemma to fallback chain after Gemini exhausted

// ============================================================================
// MODELS
// ============================================================================

export const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';

export const MODELS = {
  'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite-preview',
  'gemini-3-flash':        'gemini-3-flash-preview',
  'gemini-2.5-flash':      'gemini-2.5-flash',
  'gemini-2.5-pro':        'gemini-2.5-pro',
  'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite',
  'gemma-4-27b':           'gemma-4-27b-it',
  'gemma-4-9b':            'gemma-4-9b-it',
  'gemma-4-26b':           'gemma-4-26b-a4b-it',
  'gemma-4-31b':           'gemma-4-31b-it'
};

export const GEMINI_3_MODELS = [
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview'
];

export const GEMMA_MODELS = [
  'gemma-4-26b-a4b-it',
  'gemma-4-31b-it'
];

export const GEMMA_DAILY_LIMIT_PER_KEY     = 1500;
export const GEMMA_SUPPORTED_MIME_PREFIXES = ['image/'];
export const GEMMA_SUPPORTED_EXTENSIONS    = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'];

/** @param {string} modelName @returns {boolean} */
export function isGemmaModel(modelName) {
  return GEMMA_MODELS.includes(modelName) || /gemma/i.test(modelName);
}

// ============================================================================
// MODEL FALLBACK & RATE LIMITS
// ============================================================================

/** Models tried in order when rate limits are hit. */
export const MODEL_FALLBACK_CHAIN = [
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash'
];

/** Proactive call-count threshold per model before rotating to next. */
export const MODEL_CALL_THRESHOLDS = {
  'gemini-3.1-flash-lite-preview': 500
};

export const RATE_LIMIT_ERRORS = [429, 'RESOURCE_EXHAUSTED', 'RATE_LIMIT_EXCEEDED', 'QUOTA_EXCEEDED'];

// ============================================================================
// GENERATION CONFIG
// ============================================================================

const GENERATION_CONFIG_DEFAULTS = { TEMPERATURE: 1.0, TOP_P: 0.95 };

function isGemini3Model(modelName) { return GEMINI_3_MODELS.includes(modelName); }

function getGemmaConfig(thinking = false) {
  return {
    temperature: GENERATION_CONFIG_DEFAULTS.TEMPERATURE,
    topP:        GENERATION_CONFIG_DEFAULTS.TOP_P,
    ...(thinking ? { thinkingConfig: { thinkingLevel: 'high' } } : {})
  };
}

function getGeminiConfig() {
  return { temperature: GENERATION_CONFIG_DEFAULTS.TEMPERATURE, topP: GENERATION_CONFIG_DEFAULTS.TOP_P };
}

export function getGenerationConfig(modelName) {
  if (isGemmaModel(modelName))   return getGemmaConfig();
  if (isGemini3Model(modelName)) return getGeminiConfig();
  return getGeminiConfig();
}

export const generationConfig = getGenerationConfig('gemini-3-flash-preview');

// ============================================================================
// SAFETY SETTINGS
// ============================================================================

export const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,   threshold: HarmBlockThreshold.BLOCK_NONE },
];

// ============================================================================
// QUEUE & MEDIA LIMITS
// ============================================================================

export const RAM_MEDIA_SUSPEND_THRESHOLD_MB = 380;   // suspend media above this RSS (MB)
export const KEY_SWITCH_HOLD_MS             = 1500;  // delay (ms) after key rotation before next dispatch
export const MAX_QUEUE_DEPTH_PER_USER       = 5;     // drop new messages beyond this queue depth per user
export const PDF_ENABLED_FOR_GEMINI         = false; // PDFs are large; disable to save RAM/quota
export const CACHE_ENABLED                  = false; // Redis L3 cache — in-memory L1/L2 always active

// ============================================================================
// BOT STATE
// ============================================================================

export const STATE_CONFIG = Object.freeze({
  MAX_MESSAGES:            50,
  CONTEXT_BREAK_THRESHOLD: 1_800_000 // 30 min gap triggers a context break marker in history
});

// ============================================================================
// RESOURCE INTERVALS
// ============================================================================

export const RESOURCE_CONFIG = Object.freeze({
  STATE_SAVE_INTERVAL: 300_000,  // 5 minutes — periodic state flush to DB
  STATS_LOG_INTERVAL:  900_000   // 15 minutes — API key statistics log
});

// ============================================================================
// MIGRATION
// ============================================================================

export const MIGRATION_CONFIG = {
  ENABLE_MIGRATION: false, // set true to trigger one-shot migration on next startup; auto-clears
  BATCH_SIZE:       50,
  BATCH_DELAY_MS:   100
};

// ============================================================================
// POLL
// ============================================================================

export const POLL_CONFIG = Object.freeze({
  maxPollsPerMinute:   3,
  maxResultsPerMinute: 5,
  autoRespondToPolls:  true,
  minVotesForAnalysis: 1
});

// ============================================================================
// DATABASE — CONNECTION
// ============================================================================

export const DB_CONNECTION_CONFIG = Object.freeze({
  MAX_POOL_SIZE:               3,    // Render free tier — keep low
  MIN_POOL_SIZE:               1,
  SERVER_SELECTION_TIMEOUT_MS: 5_000,
  SOCKET_TIMEOUT_MS:           30_000,
  MAX_IDLE_TIME_MS:            60_000, // aggressively close idle sockets
  RETRY_WRITES:                true,
  W:                           'majority'
});

export const DB_RETRY_CONFIG = Object.freeze({
  MAX_ATTEMPTS:  3,
  BASE_DELAY_MS: 1_000,
  MAX_DELAY_MS:  5_000
});

export const DB_VECTOR_SEARCH_CONFIG = Object.freeze({
  INDEX_NAME:                'vector_index',
  PATH:                      'embedding',
  NUM_CANDIDATES_MULTIPLIER: 10,   // halved from 20 for sub-3s latency on Render free tier
  DEFAULT_LIMIT:             4,
  SCORE_THRESHOLD:           0.72  // drop results below this similarity score
});

// ============================================================================
// MEMORY — SYSTEM (RAG retrieval facade)
// ============================================================================

export const MEMORY_RECENT_WINDOW  = 10;       // recent messages kept in context (not vector-indexed)
export const MEMORY_MAX_RAG_RESULTS = 3;        // max vector search hits injected into prompt
export const MEMORY_SCORE_THRESHOLD = 0.72;    // aligned with DB_VECTOR_SEARCH_CONFIG.SCORE_THRESHOLD
export const MEMORY_TIME_GAP_MS     = 30_000;  // gap triggering a TIME ELAPSED marker in history
export const MEMORY_MAX_INLINE_CTX  = 1500;    // drop context blocks larger than this (chars)

// ============================================================================
// MEMORY — CACHE (L1 in-process query deduplication)
// ============================================================================

export const MEMORY_CACHE_TTL_MS        = 2 * 60 * 1000; // 2 minutes
export const MEMORY_CACHE_MAX_SIZE      = 200;
export const MEMORY_CACHE_MIN_QUERY_LEN = 10;
/** Semantic similarity threshold for cache hits — tight enough to avoid false positives. */
export const MEMORY_CACHE_SEMANTIC_SIM  = 0.92;

// ============================================================================
// MEMORY — STORE (background chunking / indexing)
// ============================================================================

export const MEMORY_CHUNK_SIZE            = 8;
export const MEMORY_CHUNK_OVERLAP         = 2;
export const MEMORY_INDEX_BATCH_SIZE      = 3;             // parallel embedding requests per cycle
export const MEMORY_PERSONAL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — TTL for personal data cache

// ============================================================================
// MEMORY — CLUSTER ENGINE (K-means++ hierarchical search)
// RAM budget: each embedding ≈ 12 KB; 300 × 15 users ≈ 54 MB — safe for 512 MB deployments.
// ============================================================================

export const CLUSTER_MAX                 = 20;
export const CLUSTER_NUM_BASELINE        = 5;
export const CLUSTER_MIN_MEMORIES        = 150;    // start clustering after this many entries
export const CLUSTER_TOP_TO_SEARCH       = 2;
export const CLUSTER_MIN_SIMILARITY      = 0.45;
export const CLUSTER_REINDEX_INTERVAL    = 150;    // rebuild clusters every N new memories
export const CLUSTER_MAX_KMEANS_ITERS    = 10;
export const CLUSTER_CONVERGENCE_THRESHOLD = 0.001;
export const CLUSTER_CACHE_TTL_MS        = 15 * 60 * 1000;
export const CLUSTER_MAX_PER_CLUSTER     = 8;
export const CLUSTER_EMBEDDINGS_TTL_MS   = 2 * 60 * 1000; // short TTL so new memories appear quickly

export const CLUSTER_EMBEDDING_LIMITS = Object.freeze({
  CLUSTER_SAMPLE:       300, // stratified time-bucket sample; do NOT raise without RAM analysis
  CLUSTER_TIME_BUCKETS: 6,
  FALLBACK_SEARCH:      30   // emergency fallback when $vectorSearch index is down
});

// ============================================================================
// MEMORY — EMBEDDING SERVICE
// ============================================================================

export const EMBEDDING_MODEL            = 'gemini-embedding-2-preview';
export const EMBEDDING_CACHE_MAX_SIZE   = 50;             // hot in-process LRU window
export const EMBEDDING_MAX_CONCURRENT   = 3;
export const EMBEDDING_DIM              = 768;
export const EMBEDDING_MRL_SHORT_DIM    = 256;            // fast centroid search
export const EMBEDDING_MRL_CENTROID_DIM = 64;             // K-means first-pass scoring
export const EMBEDDING_REDIS_TTL        = 24 * 60 * 60;  // 24h — embeddings are deterministic
export const EMBEDDING_REDIS_PREFIX     = 'lumin:emb:';

// Per-modality feature flags (gemini-embedding-2-preview model constraints)
export const EMBEDDING_ENABLE_PDF   = false;
export const EMBEDDING_ENABLE_VIDEO = false;
export const EMBEDDING_ENABLE_AUDIO = false;

export const EMBEDDING_IMAGE_LIMIT = Object.freeze({
  MAX_COUNT:  6,
  MIME_TYPES: new Set(['image/png', 'image/jpeg'])
});

export const EMBEDDING_PDF_LIMIT = Object.freeze({
  MAX_COUNT: 1, MAX_PAGES: 6, MIME_TYPE: 'application/pdf'
});

export const EMBEDDING_VIDEO_LIMIT = Object.freeze({
  MAX_COUNT: 1, MAX_SECONDS: 120, WITH_AUDIO_MAX_SECONDS: 80,
  MIME_TYPES: new Set(['video/mp4', 'video/quicktime'])
});

export const EMBEDDING_AUDIO_LIMIT = Object.freeze({
  MAX_COUNT: 1, MAX_SECONDS: 80,
  MIME_TYPES: new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav'])
});

// ============================================================================
// UTILS
// ============================================================================

export const UPLOAD_CONFIG = Object.freeze({
  SITE_URL:    'https://bin.mudfish.net',
  ENDPOINT:    '/api/text',
  TTL_MINUTES: 10080,
  TIMEOUT_MS:  3000
});

export const MESSAGE_FETCH_CONFIG = Object.freeze({
  MAX_ADDITIONAL: 99,
  DEFAULT_COUNT:  1
});

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
  BOT_CONFIG,
  ENABLE_GEMMA, GEMMA_DEFAULT_MODEL, GEMMA_FALLBACK_MODEL, CYCLE_GEMMA_WITH_GEMINI,
  DEFAULT_MODEL, MODELS, GEMINI_3_MODELS, GEMMA_MODELS,
  GEMMA_DAILY_LIMIT_PER_KEY, GEMMA_SUPPORTED_MIME_PREFIXES, GEMMA_SUPPORTED_EXTENSIONS,
  isGemmaModel,
  MODEL_FALLBACK_CHAIN, MODEL_CALL_THRESHOLDS, RATE_LIMIT_ERRORS,
  getGenerationConfig, generationConfig,
  safetySettings,
  RAM_MEDIA_SUSPEND_THRESHOLD_MB, KEY_SWITCH_HOLD_MS, MAX_QUEUE_DEPTH_PER_USER,
  PDF_ENABLED_FOR_GEMINI, CACHE_ENABLED,
  STATE_CONFIG, RESOURCE_CONFIG, MIGRATION_CONFIG, POLL_CONFIG,
  DB_CONNECTION_CONFIG, DB_RETRY_CONFIG, DB_VECTOR_SEARCH_CONFIG,
  MEMORY_RECENT_WINDOW, MEMORY_MAX_RAG_RESULTS, MEMORY_SCORE_THRESHOLD,
  MEMORY_TIME_GAP_MS, MEMORY_MAX_INLINE_CTX,
  MEMORY_CACHE_TTL_MS, MEMORY_CACHE_MAX_SIZE, MEMORY_CACHE_MIN_QUERY_LEN, MEMORY_CACHE_SEMANTIC_SIM,
  MEMORY_CHUNK_SIZE, MEMORY_CHUNK_OVERLAP, MEMORY_INDEX_BATCH_SIZE, MEMORY_PERSONAL_CACHE_TTL_MS,
  CLUSTER_MAX, CLUSTER_NUM_BASELINE, CLUSTER_MIN_MEMORIES, CLUSTER_TOP_TO_SEARCH,
  CLUSTER_MIN_SIMILARITY, CLUSTER_REINDEX_INTERVAL, CLUSTER_MAX_KMEANS_ITERS,
  CLUSTER_CONVERGENCE_THRESHOLD, CLUSTER_CACHE_TTL_MS, CLUSTER_MAX_PER_CLUSTER,
  CLUSTER_EMBEDDINGS_TTL_MS, CLUSTER_EMBEDDING_LIMITS,
  EMBEDDING_MODEL, EMBEDDING_CACHE_MAX_SIZE, EMBEDDING_MAX_CONCURRENT,
  EMBEDDING_DIM, EMBEDDING_MRL_SHORT_DIM, EMBEDDING_MRL_CENTROID_DIM,
  EMBEDDING_REDIS_TTL, EMBEDDING_REDIS_PREFIX,
  EMBEDDING_ENABLE_PDF, EMBEDDING_ENABLE_VIDEO, EMBEDDING_ENABLE_AUDIO,
  EMBEDDING_IMAGE_LIMIT, EMBEDDING_PDF_LIMIT, EMBEDDING_VIDEO_LIMIT, EMBEDDING_AUDIO_LIMIT,
  UPLOAD_CONFIG, MESSAGE_FETCH_CONFIG
};
