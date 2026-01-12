import { HarmBlockThreshold, HarmCategory } from '@google/genai';

export const DEFAULT_MODEL = 'gemini-2.5-flash';

export const MODELS = {
  'gemini-3-flash': 'gemini-3-flash-preview',
  'gemini-2.5-flash': 'gemini-2.5-flash',
  'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
  'gemini-2.5-pro': 'gemini-2.5-pro',
  'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite'
};

export const GEMINI_3_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3-pro-preview'
];

export const MODEL_FALLBACK_CHAIN = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite'
];

export const RATE_LIMIT_ERRORS = [
  429,
  'RESOURCE_EXHAUSTED',
  'RATE_LIMIT_EXCEEDED',
  'QUOTA_EXCEEDED'
];

const GENERATION_CONFIG_DEFAULTS = {
  TEMPERATURE: 1.0,
  TOP_P: 0.95
};

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

function isGemini3Model(modelName) {
  return GEMINI_3_MODELS.includes(modelName);
}

function getGemini3Config() {
  return {
    temperature: GENERATION_CONFIG_DEFAULTS.TEMPERATURE,
    topP: GENERATION_CONFIG_DEFAULTS.TOP_P,
    thinkingConfig: {
      thinkingLevel: THINKING_CONFIG.GEMINI_3.DEFAULT
    }
  };
}

function getGemini2Config() {
  return {
    temperature: GENERATION_CONFIG_DEFAULTS.TEMPERATURE,
    topP: GENERATION_CONFIG_DEFAULTS.TOP_P,
    thinkingConfig: {
      thinkingBudget: THINKING_CONFIG.GEMINI_2.DEFAULT
    }
  };
}

export function getGenerationConfig(modelName) {
  if (isGemini3Model(modelName)) {
    return getGemini3Config();
  }
  return getGemini2Config();
}

export const generationConfig = getGenerationConfig('gemini-3-flash-preview');
