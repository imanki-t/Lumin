import { HarmBlockThreshold, HarmCategory } from '@google/genai';

// ============================================================================
// MASTER OVERRIDE — edit this to control the bot globally
// These settings take precedence over ALL user and server settings.
// ============================================================================

/**
 * Enable Gemma for all chat conversations globally.
 * When true, every conversation uses GEMMA_DEFAULT_MODEL automatically.
 * Gemma is automatically excluded from contexts requiring incompatible tools
 * (e.g. /search slash command, /summary — those fall back to Gemini).
 */
export const ENABLE_GEMMA = false;

/**
 * Primary Gemma model when ENABLE_GEMMA is true.
 * Must be a key from the MODELS object below (e.g. 'gemma-4-27b').
 */
export const GEMMA_DEFAULT_MODEL = 'gemma-4-27b';

/**
 * Fallback Gemma model used when GEMMA_DEFAULT_MODEL is rate-limited.
 * Must be a key from the MODELS object below (e.g. 'gemma-4-9b').
 */
export const GEMMA_FALLBACK_MODEL = 'gemma-4-9b';

/**
 * When true, cycles through Gemma models AFTER all Gemini models are exhausted
 * in the RPM fallback chain. Server-side setting — applies to all users.
 * Gemma is added to the end of MODEL_FALLBACK_CHAIN automatically at runtime.
 */
export const CYCLE_GEMMA_WITH_GEMINI = false;

/**
 * Enable or disable Redis RAG cache.
 * Set to false to save RAM and avoid Redis costs (in-memory L1/L2 still active).
 * Redis cache is an L3 layer that survives restarts — not needed on a budget.
 */
export const CACHE_ENABLED = false;

/**
 * Disable PDF attachments for normal Gemini models.
 * PDFs are large and expensive to process. Disable to save RAM and quota.
 * Gemma already ignores PDFs by its own limitations.
 */
export const PDF_ENABLED_FOR_GEMINI = false;

/**
 * RAM threshold in MB. When process RAM exceeds this, media processing
 * (images, video, audio) is temporarily suspended to allow recovery.
 * Suspension lifts automatically once RAM drops below the threshold.
 * Set to 0 to disable the safety guard entirely.
 */
export const RAM_MEDIA_SUSPEND_THRESHOLD_MB = 380;

/**
 * When switching API keys due to rate limits, wait this many ms before
 * dispatching queued messages. Prevents hammering the new key immediately.
 * Set to 0 to disable the hold.
 */
export const KEY_SWITCH_HOLD_MS = 1500;

/**
 * Max queue depth per user. If a user's queue grows beyond this, new messages
 * are dropped with a warning rather than queued. Prevents unbounded RAM growth.
 */
export const MAX_QUEUE_DEPTH_PER_USER = 5;

// ============================================================================
// MODEL CONFIGURATION
// ============================================================================

/**
 * Default model to use when no preference is set
 */
export const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';

/**
 * Available models mapping
 * Maps user-friendly names to actual API model identifiers
 */
export const MODELS = {
  'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite-preview',
  'gemini-3-flash':        'gemini-3-flash-preview',
  'gemini-2.5-flash':      'gemini-2.5-flash',
  'gemini-2.5-pro':        'gemini-2.5-pro',
  'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite',
  'gemma-4-27b':           'gemma-4-27b-it',
  'gemma-4-9b':            'gemma-4-9b-it',
  'gemma-4-26b':           'gemma-4-26b-a4b-it',
  'gemma-4-31b':           'gemma-4-31b-it'};

/**
 * Gemini 3 model identifiers
 */
export const GEMINI_3_MODELS = [
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview'
];

/**
 * Gemma model identifiers
 */
export const GEMMA_MODELS = [
  'gemma-4-26b-a4b-it',
  'gemma-4-31b-it'
];

/**
 * Max daily requests per API key for Gemma models (RPD limit)
 */
export const GEMMA_DAILY_LIMIT_PER_KEY = 1500;

/**
 * Gemma-supported attachment MIME type prefixes and extensions.
 * Only images and GIFs — everything else is silently ignored.
 */
export const GEMMA_SUPPORTED_MIME_PREFIXES = ['image/'];
export const GEMMA_SUPPORTED_EXTENSIONS    = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'];

/**
 * Check if a model is a Gemma model
 * @param {string} modelName
 * @returns {boolean}
 */
export function isGemmaModel(modelName) {
  return GEMMA_MODELS.includes(modelName) || /gemma/i.test(modelName);
}

/**
 * Model fallback chain for rate limiting
 * Models are tried in order when rate limits are hit.
 * - gemini-3.1-flash-lite-preview: Primary model, switches after 500 calls or on actual 429
 * - gemini-2.5-flash: Fallback, uses standard 15 RPM proactive rotation
 * Note: gemini-2.5-flash-lite is intentionally excluded — it shares the same
 * quota as gemini-3.1-flash-lite-preview, so keeping both would waste quota.
 */
export const MODEL_FALLBACK_CHAIN = [
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash'
];

/**
 * Proactive call-count threshold per model.
 * After this many successful calls, the bot will proactively switch to the
 * next model in MODEL_FALLBACK_CHAIN rather than waiting for a 429 error.
 * Models not listed here use only reactive switching (on actual 429 errors).
 */
export const MODEL_CALL_THRESHOLDS = {
  'gemini-3.1-flash-lite-preview': 500  // Switch to 2.5-flash after 500 calls
};

/**
 * Rate limit error identifiers
 */
export const RATE_LIMIT_ERRORS = [
  429,
  'RESOURCE_EXHAUSTED',
  'RATE_LIMIT_EXCEEDED',
  'QUOTA_EXCEEDED'
];

// ============================================================================
// GENERATION CONFIGURATION
// ============================================================================

/**
 * Default generation config values
 */
const GENERATION_CONFIG_DEFAULTS = {
  TEMPERATURE: 1.0,
  TOP_P: 0.95
};

/**
 * Thinking configuration for different model families
 */
const THINKING_CONFIG = {
  GEMINI_3: {
    LOW: 'low',
    MINIMAL: 'minimal',
    MEDIUM: 'medium',
    HIGH: 'high',
    DEFAULT: 'low'
  },
  GEMINI_2: {
    DYNAMIC: -1,
    DEFAULT: -1
  }
};

// ============================================================================
// SAFETY SETTINGS
// ============================================================================

/**
 * Safety settings for content filtering
 * Currently set to BLOCK_NONE for all categories
 */
export const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a model is a Gemini 3 model
 * @param {string} modelName - Model identifier
 * @returns {boolean}
 */
function isGemini3Model(modelName) {
  return GEMINI_3_MODELS.includes(modelName);
}

/**
 * Get generation config for Gemma models
 * Thinking is on/off only — no levels
 * @param {boolean} [thinking=false]
 * @returns {Object}
 */
function getGemmaConfig(thinking = false) {
  return {
    temperature: GENERATION_CONFIG_DEFAULTS.TEMPERATURE,
    topP:        GENERATION_CONFIG_DEFAULTS.TOP_P,
    ...(thinking ? { thinkingConfig: { thinkingLevel: 'high' } } : {})
  };
}

/**
 * Get generation config for Gemini 3 models
 * @returns {Object} Generation configuration
 */
function getGemini3Config() {
  return {
    temperature: GENERATION_CONFIG_DEFAULTS.TEMPERATURE,
    topP: GENERATION_CONFIG_DEFAULTS.TOP_P,
    // Thinking disabled to allow tool use
    /* thinkingConfig: {
      thinkingLevel: THINKING_CONFIG.GEMINI_3.DEFAULT
    }
    */
  };
}

/**
 * Get generation config for Gemini 2 models
 * @returns {Object} Generation configuration
 */
function getGemini2Config() {
  return {
    temperature: GENERATION_CONFIG_DEFAULTS.TEMPERATURE,
    topP: GENERATION_CONFIG_DEFAULTS.TOP_P,
    // Thinking disabled to allow tool use
    /*
    thinkingConfig: {
      thinkingBudget: THINKING_CONFIG.GEMINI_2.DEFAULT
    }
    */
  };
}

/**
 * Get appropriate generation config for a model
 * @param {string} modelName - Model identifier
 * @returns {Object} Generation configuration
 */
export function getGenerationConfig(modelName) {
  if (isGemmaModel(modelName))    return getGemmaConfig();
  if (isGemini3Model(modelName))  return getGemini3Config();
  return getGemini2Config();
}

/**
 * Default generation config (using Gemini 3 Flash as reference)
 */
export const generationConfig = getGenerationConfig('gemini-3-flash-preview');

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  ENABLE_GEMMA,
  GEMMA_DEFAULT_MODEL,
  GEMMA_FALLBACK_MODEL,
  CYCLE_GEMMA_WITH_GEMINI,
  CACHE_ENABLED,
  PDF_ENABLED_FOR_GEMINI,
  RAM_MEDIA_SUSPEND_THRESHOLD_MB,
  KEY_SWITCH_HOLD_MS,
  MAX_QUEUE_DEPTH_PER_USER,
  DEFAULT_MODEL,
  MODELS,
  GEMINI_3_MODELS,
  GEMMA_MODELS,
  GEMMA_DAILY_LIMIT_PER_KEY,
  GEMMA_SUPPORTED_MIME_PREFIXES,
  GEMMA_SUPPORTED_EXTENSIONS,
  MODEL_FALLBACK_CHAIN,
  MODEL_CALL_THRESHOLDS,
  RATE_LIMIT_ERRORS,
  safetySettings,
  getGenerationConfig,
  generationConfig,
  isGemmaModel
};
