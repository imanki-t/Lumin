import { HarmBlockThreshold, HarmCategory } from '@google/genai';

export const MODELS = {
  'gemini-3-flash': 'gemini-3-flash-preview',
  'gemini-2.5-flash': 'gemini-2.5-flash',
  'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
  'gemini-2.5-pro': 'gemini-2.5-pro',
  'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite'
};

// Centralized default model setting
export const DEFAULT_MODEL = 'gemini-2.5-flash';

// Gemini 3.0 models that support thinking_level
export const GEMINI_3_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3-pro-preview'
];

// Fallback chain for model failures
export const MODEL_FALLBACK_CHAIN = [
  'gemini-2.5-flash',      // Primary: Gemini 3.0 Flash
  'gemini-2.5-flash-lite',             // Fallback 1: Gemini 2.5 Flash
  'gemini-2.0-flash-lite'         // Fallback 2: Gemini 2.5 Flash Lite
];

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

// Get generation config based on model version
export function getGenerationConfig(modelName) {
  const isGemini3 = GEMINI_3_MODELS.includes(modelName);
  
  if (isGemini3) {
    // Gemini 3.0 models use thinking_level
    return {
      temperature: 1.0,  // Gemini 3 is optimized for temp 1.0
      topP: 0.95,
      thinkingConfig: {
        thinkingLevel: 'low'  // Options: 'minimal', 'low', 'medium', 'high'
      }
    };
  } else {
    // Gemini 2.5 models use thinking_budget
    return {
      temperature: 1.0,
      topP: 0.95,
      thinkingConfig: {
        thinkingBudget: -1  // -1 for dynamic thinking
      }
    };
  }
}

// Error codes that indicate rate limit or quota exceeded
export const RATE_LIMIT_ERRORS = [
  429,  // Too Many Requests
  'RESOURCE_EXHAUSTED',
  'RATE_LIMIT_EXCEEDED',
  'QUOTA_EXCEEDED'
];

export const generationConfig = getGenerationConfig('gemini-3-flash-preview');
