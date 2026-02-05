import { HarmBlockThreshold, HarmCategory } from '@google/genai';

// ============================================================================
// MODEL CONFIGURATION
// ============================================================================

/**
 * Default model to use when no preference is set
 */
export const DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Available models mapping
 * Maps user-friendly names to actual API model identifiers
 */
export const MODELS = {
  'gemini-3-flash': 'gemini-3-flash-preview',
  'gemini-2.5-flash': 'gemini-2.5-flash',
  'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
  'gemini-2.5-pro': 'gemini-2.5-pro',
  'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite'
};

/**
 * Gemini 3 model identifiers
 */
export const GEMINI_3_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3-pro-preview'
];

/**
 * Model fallback chain for rate limiting
 * Models are tried in order when rate limits are hit
 */
export const MODEL_FALLBACK_CHAIN = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
];

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
 * Get generation config for Gemini 3 models
 * @returns {Object} Generation configuration
 */
function getGemini3Config() {
  return {
    temperature: GENERATION_CONFIG_DEFAULTS.TEMPERATURE,
    topP: GENERATION_CONFIG_DEFAULTS.TOP_P,
    thinkingConfig: {
      thinkingLevel: THINKING_CONFIG.GEMINI_3.DEFAULT
    }
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
    thinkingConfig: {
      thinkingBudget: THINKING_CONFIG.GEMINI_2.DEFAULT
    }
  };
}

/**
 * Get appropriate generation config for a model
 * @param {string} modelName - Model identifier
 * @returns {Object} Generation configuration
 */
export function getGenerationConfig(modelName) {
  if (isGemini3Model(modelName)) {
    return getGemini3Config();
  }
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
  DEFAULT_MODEL,
  MODELS,
  GEMINI_3_MODELS,
  MODEL_FALLBACK_CHAIN,
  RATE_LIMIT_ERRORS,
  safetySettings,
  getGenerationConfig,
  generationConfig
};
