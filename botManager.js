/**
 * @fileoverview Discord Bot Manager - Core bot management, API key rotation, and state management
 * @version 3.0.0
 * @module botManager
 * 
 * This module handles:
 * - Discord client initialization and configuration
 * - Google Gemini AI API key rotation and rate limiting (per-model tracking)
 * - Bot state management (chat histories, settings, user data)
 * - Database operations coordination
 * - Request queue management
 * - Resource lifecycle management
 * 
 * @requires discord.js ^14.16.3
 * @requires @google/genai ^1.0.1
 * @requires dotenv ^16.4.7
 */

import dotenv from 'dotenv';
dotenv.config();

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import * as db from './database.js';

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/**
 * Rate limiting configuration
 * Adjust these values to control API usage patterns
 */
const RATE_LIMIT_CONFIG = {
  /** Requests per minute per model per API key */
  REQUESTS_PER_MINUTE: 15,
  
  /** Time window for rate limiting in milliseconds */
  WINDOW_DURATION_MS: 60000,
  
  /** Cooldown duration when rate limit is hit */
  COOLDOWN_DURATION_MS: 60000,
  
  /** Maximum retry attempts for failed API calls */
  MAX_RETRY_ATTEMPTS: 3,
  
  /** Delay multipliers for different error types (ms) */
  RETRY_DELAYS: {
    FORBIDDEN: 3000,
    RATE_LIMIT: 2500,
    SERVER_ERROR: 1000,
    DEFAULT: 1000
  }
};

/**
 * Resource management configuration
 */
const RESOURCE_CONFIG = {
  /** Interval for periodic state saves (ms) */
  STATE_SAVE_INTERVAL: 300000, // 5 minutes
  
  /** Interval for API key statistics logging (ms) */
  STATS_LOG_INTERVAL: 900000, // 15 minutes
  
  /** Maximum embedding cache size */
  MAX_CACHE_SIZE: 1000,
  
  /** File cleanup age threshold (ms) */
  FILE_CLEANUP_AGE: 3600000, // 1 hour
  
  /** Daily reset time (UTC hours) */
  DAILY_RESET_HOUR: 0
};

/**
 * State management configuration
 */
const STATE_CONFIG = {
  /** Maximum messages to keep in chat history */
  MAX_MESSAGES: 50,
  
  /** Time threshold for context breaks (ms) */
  CONTEXT_BREAK_THRESHOLD: 1800000, // 30 minutes
  
  /** Queue size limit per user */
  MAX_QUEUE_SIZE: 5
};

/**
 * Model fallback chain
 * Models are tried in order when rate limits are hit
 */
const MODEL_FALLBACK_CHAIN = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite'
];

// ============================================================================
// FILE SYSTEM SETUP
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Temporary directory for file operations */
export const TEMP_DIR = path.join(__dirname, 'temp');

// ============================================================================
// DISCORD CLIENT INITIALIZATION
// ============================================================================

/**
 * Discord client instance with required intents and partials
 * @type {Client}
 */
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

/** Discord bot token from environment */
export const token = process.env.DISCORD_BOT_TOKEN;

// ============================================================================
// API KEY MANAGEMENT
// ============================================================================

/**
 * Load and validate API keys from environment variables
 * Supports both indexed keys (GOOGLE_API_KEY1, GOOGLE_API_KEY2, etc.)
 * and a single GOOGLE_API_KEY
 * @returns {string[]} Array of valid API keys
 */
function loadApiKeys() {
  const keys = [];
  let keyIndex = 1;

  // Load indexed keys
  while (process.env[`GOOGLE_API_KEY${keyIndex}`]) {
    const key = process.env[`GOOGLE_API_KEY${keyIndex}`];
    if (validateApiKey(key)) {
      keys.push(key);
    } else {
      console.warn(`⚠️ Invalid API key format at GOOGLE_API_KEY${keyIndex}`);
    }
    keyIndex++;
  }

  // Fallback to single key if no indexed keys found
  if (keys.length === 0 && process.env.GOOGLE_API_KEY) {
    const key = process.env.GOOGLE_API_KEY;
    if (validateApiKey(key)) {
      keys.push(key);
    } else {
      console.warn('⚠️ Invalid API key format at GOOGLE_API_KEY');
    }
  }

  if (keys.length === 0) {
    throw new Error('No valid API keys found in environment variables');
  }

  console.log(`✅ Loaded ${keys.length} API key(s)`);
  return keys;
}

/**
 * Validate API key format
 * @param {string} key - API key to validate
 * @returns {boolean} True if key is valid
 */
function validateApiKey(key) {
  return typeof key === 'string' && key.length > 20 && !key.includes(' ');
}

/** Array of Google Gemini API keys */
const apiKeys = loadApiKeys();

/** Current active API key index */
let currentKeyIdx = 0;

/** Current Google AI client instance */
let currentClient = new GoogleGenAI({ apiKey: apiKeys[currentKeyIdx] });

// ============================================================================
// RATE LIMITING STATE
// ============================================================================

/**
 * Per-key usage statistics
 * @type {Map<number, {requests: number, lastUsed: number, errors: number, successfulRequests: number}>}
 */
const keyUsageStats = new Map();

/**
 * Per-key error tracking
 * @type {Map<number, {lastError: {message: string, timestamp: string}|null}>}
 */
const keyErrorTracking = new Map();

/**
 * Key-level cooldowns (for global key issues)
 * @type {Map<number, number>}
 */
const keyCooldowns = new Map();

/**
 * Per-model per-key rate limit tracking
 * Structure: Map<keyIdx, Map<modelName, {count: number, windowStart: number}>>
 * @type {Map<number, Map<string, {count: number, windowStart: number}>>}
 */
const keyModelRateLimits = new Map();

/**
 * Per-model per-key cooldown tracking
 * Structure: Map<keyIdx, Map<modelName, number>>
 * @type {Map<number, Map<string, number>>}
 */
const keyModelCooldowns = new Map();

// Initialize tracking for all keys
apiKeys.forEach((_, idx) => {
  keyUsageStats.set(idx, { 
    requests: 0, 
    lastUsed: null, 
    errors: 0, 
    successfulRequests: 0 
  });
  keyErrorTracking.set(idx, { lastError: null });
  keyModelRateLimits.set(idx, new Map());
  keyModelCooldowns.set(idx, new Map());
});

// ============================================================================
// RATE LIMITING FUNCTIONS
// ============================================================================

/**
 * Check if a specific model on a specific key has exceeded its rate limit
 * @param {number} keyIdx - API key index
 * @param {string} modelName - Model identifier
 * @returns {boolean} True if rate limited
 */
function isModelRateLimited(keyIdx, modelName) {
  const modelLimits = keyModelRateLimits.get(keyIdx);
  if (!modelLimits) return false;

  const rateLimitData = modelLimits.get(modelName);
  if (!rateLimitData) return false;

  const now = Date.now();
  const elapsed = now - rateLimitData.windowStart;

  // Reset window if more than 1 minute has passed
  if (elapsed >= RATE_LIMIT_CONFIG.WINDOW_DURATION_MS) {
    rateLimitData.count = 0;
    rateLimitData.windowStart = now;
    modelLimits.set(modelName, rateLimitData);
    return false;
  }

  return rateLimitData.count >= RATE_LIMIT_CONFIG.REQUESTS_PER_MINUTE;
}

/**
 * Increment rate limit counter for a specific model on a specific key
 * @param {number} keyIdx - API key index
 * @param {string} modelName - Model identifier
 */
function incrementModelRateLimit(keyIdx, modelName) {
  const modelLimits = keyModelRateLimits.get(keyIdx);
  if (!modelLimits) {
    console.error(`Rate limit tracking not initialized for key ${keyIdx}`);
    return;
  }

  let rateLimitData = modelLimits.get(modelName);
  const now = Date.now();

  if (!rateLimitData) {
    // Initialize tracking for this model
    rateLimitData = { count: 1, windowStart: now };
    modelLimits.set(modelName, rateLimitData);
    return;
  }

  const elapsed = now - rateLimitData.windowStart;

  // Reset window if more than 1 minute has passed
  if (elapsed >= RATE_LIMIT_CONFIG.WINDOW_DURATION_MS) {
    rateLimitData.count = 1;
    rateLimitData.windowStart = now;
  } else {
    rateLimitData.count++;
  }

  modelLimits.set(modelName, rateLimitData);
}

/**
 * Set cooldown for a specific model on a specific key
 * @param {number} keyIdx - API key index
 * @param {string} modelName - Model identifier
 * @param {number} [cooldownMs] - Cooldown duration in milliseconds
 */
function setModelCooldown(keyIdx, modelName, cooldownMs = RATE_LIMIT_CONFIG.COOLDOWN_DURATION_MS) {
  const modelCooldowns = keyModelCooldowns.get(keyIdx);
  if (!modelCooldowns) {
    console.error(`Cooldown tracking not initialized for key ${keyIdx}`);
    return;
  }

  const cooldownUntil = Date.now() + cooldownMs;
  modelCooldowns.set(modelName, cooldownUntil);
  console.warn(`⏱️ Key ${keyIdx + 1} / Model ${modelName} on ${cooldownMs / 1000}s cooldown`);
}

/**
 * Check if a specific model on a specific key is on cooldown
 * @param {number} keyIdx - API key index
 * @param {string} modelName - Model identifier
 * @returns {boolean} True if on cooldown
 */
function isModelOnCooldown(keyIdx, modelName) {
  const modelCooldowns = keyModelCooldowns.get(keyIdx);
  if (!modelCooldowns) return false;

  const cooldownUntil = modelCooldowns.get(modelName) || 0;
  return Date.now() < cooldownUntil;
}

/**
 * Find the next available model for the current key
 * Tries fallback models in order before giving up
 * @param {string} currentModelName - Current model that hit rate limit
 * @returns {string|null} Next available model name, or null if all exhausted
 */
function findAvailableModel(currentModelName) {
  const now = Date.now();
  const currentModelIdx = MODEL_FALLBACK_CHAIN.indexOf(currentModelName);
  
  // Try each model in the fallback chain
  for (let i = 1; i < MODEL_FALLBACK_CHAIN.length; i++) {
    const testModelIdx = (currentModelIdx + i) % MODEL_FALLBACK_CHAIN.length;
    const testModelName = MODEL_FALLBACK_CHAIN[testModelIdx];
    
    // Skip if this model is on cooldown for current key
    if (isModelOnCooldown(currentKeyIdx, testModelName)) {
      console.log(`⏭️ Model ${testModelName} on cooldown for Key ${currentKeyIdx + 1}`);
      continue;
    }
    
    // Skip if this model is rate limited for current key
    if (isModelRateLimited(currentKeyIdx, testModelName)) {
      console.log(`⏭️ Model ${testModelName} rate limited for Key ${currentKeyIdx + 1}`);
      continue;
    }
    
    console.log(`✅ Found available fallback model: ${testModelName} on Key ${currentKeyIdx + 1}`);
    return testModelName;
  }
  
  return null;
}

/**
 * Find next available API key (not on cooldown)
 * @returns {number|null} Key index, or null if all keys on cooldown
 */
function findAvailableKey() {
  const now = Date.now();
  
  // FIX: Start at i = 1 to check the NEXT key first
  for (let i = 1; i <= apiKeys.length; i++) {
    const testIdx = (currentKeyIdx + i) % apiKeys.length;
    
    // Check key-level cooldown
    const cooldownUntil = keyCooldowns.get(testIdx) || 0;
    if (now < cooldownUntil) {
      continue;
    }
    
    return testIdx;
  }
  
  return null;
}

/**
 * Enhanced key/model switching with intelligent fallback
 * Tries fallback models before rotating keys
 * 
 * @param {Error} error - Error that triggered the switch
 * @param {string} currentModelName - Model that encountered the error
 * @returns {{keyRotated: boolean, modelChanged: boolean, newModel: string|null}}
 */
export function switchToNextKeyOrModel(error, currentModelName) {
  const oldKeyIdx = currentKeyIdx;
  
  // Detect error types
  const isRateLimit = 
    error?.status === 429 ||
    error?.code === 'RESOURCE_EXHAUSTED' ||
    (error?.message?.includes('429') && !error?.message?.includes('File')) ||
    error?.message?.includes('RESOURCE_EXHAUSTED') ||
    error?.message?.includes('quota');

  const isFileError = 
    (error?.status === 403 || error?.code === 403 || error?.message?.includes('403')) &&
    (error?.message?.includes('File') || 
     error?.message?.includes('file') || 
     error?.message?.includes('PERMISSION_DENIED'));

  // CRITICAL: File permission errors should NOT trigger rotation
  // Files are tied to the key that uploaded them
  if (isFileError) {
    console.warn(`📁 File permission error - NOT rotating (files are key-specific)`);
    console.warn(`📁 Error: ${error?.message || 'Unknown file error'}`);
    return { keyRotated: false, modelChanged: false, newModel: null };
  }

  // Handle rate limit errors with intelligent fallback
  if (isRateLimit) {
    // Set cooldown for the model that hit rate limit
    setModelCooldown(oldKeyIdx, currentModelName);
    
    // STEP 1: Try to find another available model on the SAME key
    const nextModel = findAvailableModel(currentModelName);
    
    if (nextModel) {
      console.log(`🔄 Switching to fallback model: ${nextModel} (staying on Key ${oldKeyIdx + 1})`);
      return { keyRotated: false, modelChanged: true, newModel: nextModel };
    }
    
    // STEP 2: All models on current key exhausted, try to rotate key
    console.log(`⚠️ All models rate limited on Key ${oldKeyIdx + 1}, attempting key rotation...`);
    
    const nextKeyIdx = findAvailableKey();
    
    if (nextKeyIdx !== null && nextKeyIdx !== oldKeyIdx) {
      currentKeyIdx = nextKeyIdx;
      currentClient = new GoogleGenAI({ apiKey: apiKeys[currentKeyIdx] });
      console.log(`✅ Rotated to Key ${nextKeyIdx + 1}, retrying with model: ${currentModelName}`);
      return { keyRotated: true, modelChanged: false, newModel: currentModelName };
    }
    
    // STEP 3: All keys exhausted, try fallback model on current key anyway as last resort
    console.warn(`⚠️ ALL keys exhausted! Trying fallback model as last resort...`);
    const fallbackIdx = (MODEL_FALLBACK_CHAIN.indexOf(currentModelName) + 1) % MODEL_FALLBACK_CHAIN.length;
    const fallbackModel = MODEL_FALLBACK_CHAIN[fallbackIdx];
    return { keyRotated: false, modelChanged: true, newModel: fallbackModel };
  }

  // For non-rate-limit errors, just log and don't change anything
  console.log(`⚠️ Non-rate-limit error on Key ${oldKeyIdx + 1} / Model ${currentModelName}: ${error?.message || 'Unknown'}`);
  
  // Track the error
  const tracking = keyErrorTracking.get(oldKeyIdx);
  if (tracking) {
    tracking.lastError = {
      message: error?.message || 'Unknown error',
      timestamp: new Date().toISOString()
    };
  }
  
  return { keyRotated: false, modelChanged: false, newModel: null };
}

/**
 * Backward compatibility wrapper for old switchToNextKey calls
 * @deprecated Use switchToNextKeyOrModel instead
 */
export function switchToNextKey(error) {
  const result = switchToNextKeyOrModel(error, 'gemini-2.5-flash');
  return result.keyRotated || result.modelChanged;
}

/**
 * Execute an API call with automatic retry and intelligent fallback
 * Handles per-model rate limiting and key rotation
 * 
 * @param {Function} apiCall - Async function that takes model name and returns API result
 * @param {string} initialModelName - Initial model to try
 * @returns {Promise<any>} API call result
 * @throws {Error} If all retry attempts fail
 */
async function withRetryPerModel(apiCall, initialModelName) {
  let attempts = 0;
  const maxAttempts = Math.max(RATE_LIMIT_CONFIG.MAX_RETRY_ATTEMPTS, apiKeys.length);
  let currentModel = initialModelName;

  while (attempts < maxAttempts) {
    try {
      // Pre-flight check: is this model rate limited?
      if (isModelRateLimited(currentKeyIdx, currentModel)) {
        console.warn(`⏱️ Key ${currentKeyIdx + 1} / Model ${currentModel} hit rate limit (${RATE_LIMIT_CONFIG.REQUESTS_PER_MINUTE} req/min)`);
        
        const switchResult = switchToNextKeyOrModel(
          { message: 'Rate limit pre-check failed' },
          currentModel
        );
        
        if (switchResult.modelChanged && switchResult.newModel) {
          currentModel = switchResult.newModel;
          console.log(`🔄 Pre-flight switched to model: ${currentModel}`);
        } else if (switchResult.keyRotated) {
          console.log(`🔄 Pre-flight switched to Key ${currentKeyIdx + 1}`);
        }
        
        attempts++;
        continue;
      }

      // Update usage stats
      const stats = keyUsageStats.get(currentKeyIdx);
      if (stats) {
        stats.requests++;
        stats.lastUsed = Date.now();
      }

      // Increment rate limit counter for this specific model
      incrementModelRateLimit(currentKeyIdx, currentModel);

      // Execute the API call
      const result = await apiCall(currentModel);

      // Update success stats
      if (stats) {
        stats.successfulRequests++;
      }

      return result;

    } catch (error) {
      // Update error stats
      const stats = keyUsageStats.get(currentKeyIdx);
      if (stats) {
        stats.errors++;
      }

      console.warn(`API call failed (Key: ${currentKeyIdx + 1}, Model: ${currentModel}, Attempt: ${attempts + 1}): ${error.message}`);
      
      // Try to switch key or model
      const switchResult = switchToNextKeyOrModel(error, currentModel);
      
      if (switchResult.modelChanged && switchResult.newModel) {
        currentModel = switchResult.newModel;
        console.log(`🔄 Switched to fallback model: ${currentModel}`);
      } else if (switchResult.keyRotated) {
        console.log(`🔄 Switched to Key ${currentKeyIdx + 1}`);
      }
      
      attempts++;

      if (attempts >= maxAttempts) {
        throw new Error(`All retry attempts exhausted (${maxAttempts} attempts). Last error: ${error.message}`);
      }
      
      // Apply delay based on error type
      const errorMessage = error.message || '';
      let delay = RATE_LIMIT_CONFIG.RETRY_DELAYS.DEFAULT;
      
      if (errorMessage.includes('403')) {
        delay = RATE_LIMIT_CONFIG.RETRY_DELAYS.FORBIDDEN;
      } else if (errorMessage.includes('429') || errorMessage.includes('quota')) {
        delay = RATE_LIMIT_CONFIG.RETRY_DELAYS.RATE_LIMIT;
      } else if (errorMessage.includes('500') || errorMessage.includes('503')) {
        delay = RATE_LIMIT_CONFIG.RETRY_DELAYS.SERVER_ERROR;
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error(`Retry loop exited unexpectedly after ${attempts} attempts`);
}

/**
 * Legacy retry function for backward compatibility
 * @deprecated Use withRetryPerModel instead
 */
async function withRetry(apiCall) {
  return withRetryPerModel(
    async (modelName) => await apiCall(),
    'gemini-2.5-flash'
  );
}

// ============================================================================
// GEMINI AI CLIENT PROXY
// ============================================================================

/**
 * Proxied Gemini AI client that automatically handles retries and key rotation
 * All API calls go through withRetry for resilience
 * @type {Proxy}
 */
export const genAI = new Proxy({}, {
  get(target, prop) {
    if (prop === 'models') {
      return {
        generateContent: (request) => 
          withRetryPerModel(
            (modelName) => {
              request.model = modelName;
              return currentClient.models.generateContent(request);
            },
            request.model || 'gemini-2.5-flash'
          ),
        generateContentStream: (request) => 
          withRetryPerModel(
            (modelName) => {
              request.model = modelName;
              return currentClient.models.generateContentStream(request);
            },
            request.model || 'gemini-2.5-flash'
          ),
        embedContent: (request) => 
          withRetry(() => currentClient.models.embedContent(request))
      };
    }

    if (prop === 'chats') {
      return {
        create: (chatConfig) => {
          const chat = currentClient.chats.create(chatConfig);
          return {
            sendMessage: (message) => withRetry(() => chat.sendMessage(message))
          };
        }
      };
    }

    if (prop === 'files') {
      return {
        upload: (options) => withRetry(() => currentClient.files.upload(options)),
        get: (options) => withRetry(() => currentClient.files.get(options))
      };
    }

    const value = currentClient[prop];
    return typeof value === 'function' ? value.bind(currentClient) : value;
  }
});

/**
 * Create a file URI part for Gemini API
 * @param {string} fileUri - File URI from upload
 * @param {string} mimeType - MIME type of the file
 * @returns {{fileData: {fileUri: string, mimeType: string}}}
 */
export function createPartFromUri(fileUri, mimeType) {
  return {
    fileData: {
      fileUri: fileUri,
      mimeType: mimeType
    }
  };
}

// ============================================================================
// API KEY STATISTICS
// ============================================================================

/**
 * Get comprehensive statistics for all API keys
 * Includes per-model rate limit information
 * @returns {{totalKeys: number, currentKey: number, rateLimit: string, keys: Array}}
 */
export function getApiKeyStats() {
  const stats = [];
  const now = Date.now();
  
  apiKeys.forEach((key, idx) => {
    const keyStats = keyUsageStats.get(idx);
    const tracking = keyErrorTracking.get(idx);
    const cooldown = keyCooldowns.get(idx);
    const isOnCooldown = cooldown && now < cooldown;

    // Get per-model stats for this key
    const modelStats = [];
    const modelLimits = keyModelRateLimits.get(idx);
    const modelCooldowns = keyModelCooldowns.get(idx);
    
    if (modelLimits) {
      MODEL_FALLBACK_CHAIN.forEach(modelName => {
        const limitData = modelLimits.get(modelName);
        const cooldownUntil = modelCooldowns?.get(modelName) || 0;
        const isModelCooldown = now < cooldownUntil;
        const isModelLimited = limitData && isModelRateLimited(idx, modelName);
        
        // Calculate time until rate limit resets
        let secondsUntilReset = 0;
        if (limitData) {
          const timeUntilReset = Math.max(0, RATE_LIMIT_CONFIG.WINDOW_DURATION_MS - (now - limitData.windowStart));
          secondsUntilReset = Math.ceil(timeUntilReset / 1000);
        }
        
        modelStats.push({
          model: modelName,
          requestsThisMinute: limitData?.count || 0,
          rateLimited: isModelLimited,
          cooldown: isModelCooldown,
          secondsUntilReset: isModelLimited ? secondsUntilReset : 0
        });
      });
    }

    let status = '🟢 Active';
    if (isOnCooldown) {
      status = '🔴 Key Cooldown';
    } else if (modelStats.some(m => m.rateLimited || m.cooldown)) {
      status = '🟡 Partially Limited';
    }

    stats.push({
      keyNumber: idx + 1,
      keyPreview: `${key.slice(0, 8)}...`,
      isCurrent: idx === currentKeyIdx,
      status: status,
      totalRequests: keyStats?.requests || 0,
      successfulRequests: keyStats?.successfulRequests || 0,
      errors: keyStats?.errors || 0,
      lastUsed: keyStats?.lastUsed ? new Date(keyStats.lastUsed).toISOString() : 'Never',
      lastError: tracking?.lastError ? tracking.lastError.message : null,
      modelStats: modelStats
    });
  });
  
  return {
    totalKeys: apiKeys.length,
    currentKey: currentKeyIdx + 1,
    rateLimit: `${RATE_LIMIT_CONFIG.REQUESTS_PER_MINUTE} req/min per model per key`,
    effectiveCapacity: `${RATE_LIMIT_CONFIG.REQUESTS_PER_MINUTE * MODEL_FALLBACK_CHAIN.length} req/min per key (${MODEL_FALLBACK_CHAIN.length} models)`,
    keys: stats
  };
}

// ============================================================================
// REQUEST QUEUE MANAGEMENT
// ============================================================================

/**
 * Request queues for each user to prevent concurrent request processing
 * Structure: Map<userId, {queue: Array, isProcessing: boolean}>
 * @type {Map<string, {queue: Array, isProcessing: boolean}>}
 */
export const requestQueues = new Map();

/**
 * Mutex class for critical section protection
 */
class Mutex {
  constructor() {
    this._locked = false;
    this._queue = [];
  }

  /**
   * Acquire the mutex lock
   * @returns {Promise<void>}
   */
  acquire() {
    return new Promise(resolve => {
      if (!this._locked) {
        this._locked = true;
        resolve();
      } else {
        this._queue.push(resolve);
      }
    });
  }

  /**
   * Release the mutex lock
   */
  release() {
    if (this._queue.length > 0) {
      const nextResolve = this._queue.shift();
      nextResolve();
    } else {
      this._locked = false;
    }
  }

  /**
   * Execute a function with exclusive access
   * @param {Function} callback - Async function to execute
   * @returns {Promise<any>}
   */
  async runExclusive(callback) {
    await this.acquire();
    try {
      return await callback();
    } finally {
      this.release();
    }
  }
}

/**
 * Mutex for chat history operations
 * Prevents race conditions during concurrent history updates
 */
export const chatHistoryLock = new Mutex();

// ============================================================================
// BOT STATE MANAGEMENT
// ============================================================================

/**
 * Central state object containing all bot data
 * Provides getters/setters for controlled access
 */
class BotState {
  constructor() {
    this._chatHistories = {};
    this._activeUsersInChannels = {};
    this._customInstructions = {};
    this._serverSettings = {};
    this._userSettings = {};
    this._userResponsePreference = {};
    this._alwaysRespondChannels = {};
    this._channelWideChatHistory = {};
    this._blacklistedUsers = {};
    this._continuousReplyChannels = {};
    this._imageUsage = {};
    this._birthdays = {};
    this._reminders = {};
    this._dailyQuotes = {};
    this._roulette = {};
    this._complimentCounts = {};
    this._complimentOptOut = {};
    this._userTimezones = {};
    this._serverDigests = {};
    this._quoteUsage = {};
    this._starterUsage = {};
    this._complimentUsage = {};
    this._userDigests = {};
    this._realive = {};
    this._summaryUsage = {};
  }

  // Getters and setters for all state properties
  get chatHistories() { return this._chatHistories; }
  set chatHistories(v) { this._chatHistories = v; }
  
  get activeUsersInChannels() { return this._activeUsersInChannels; }
  set activeUsersInChannels(v) { this._activeUsersInChannels = v; }
  
  get customInstructions() { return this._customInstructions; }
  set customInstructions(v) { this._customInstructions = v; }
  
  get serverSettings() { return this._serverSettings; }
  set serverSettings(v) { this._serverSettings = v; }
  
  get userSettings() { return this._userSettings; }
  set userSettings(v) { this._userSettings = v; }
  
  get userResponsePreference() { return this._userResponsePreference; }
  set userResponsePreference(v) { this._userResponsePreference = v; }
  
  get alwaysRespondChannels() { return this._alwaysRespondChannels; }
  set alwaysRespondChannels(v) { this._alwaysRespondChannels = v; }
  
  get channelWideChatHistory() { return this._channelWideChatHistory; }
  set channelWideChatHistory(v) { this._channelWideChatHistory = v; }
  
  get blacklistedUsers() { return this._blacklistedUsers; }
  set blacklistedUsers(v) { this._blacklistedUsers = v; }
  
  get continuousReplyChannels() { return this._continuousReplyChannels; }
  set continuousReplyChannels(v) { this._continuousReplyChannels = v; }
  
  get requestQueues() { return requestQueues; }
  
  get imageUsage() { return this._imageUsage; }
  set imageUsage(v) { this._imageUsage = v; }
  
  get birthdays() { return this._birthdays; }
  set birthdays(v) { this._birthdays = v; }
  
  get reminders() { return this._reminders; }
  set reminders(v) { this._reminders = v; }
  
  get dailyQuotes() { return this._dailyQuotes; }
  set dailyQuotes(v) { this._dailyQuotes = v; }
  
  get roulette() { return this._roulette; }
  set roulette(v) { this._roulette = v; }
  
  get complimentCounts() { return this._complimentCounts; }
  set complimentCounts(v) { this._complimentCounts = v; }
  
  get complimentOptOut() { return this._complimentOptOut; }
  set complimentOptOut(v) { this._complimentOptOut = v; }
  
  get userTimezones() { return this._userTimezones; }
  set userTimezones(v) { this._userTimezones = v; }
  
  get serverDigests() { return this._serverDigests; }
  set serverDigests(v) { this._serverDigests = v; }
  
  get quoteUsage() { return this._quoteUsage; }
  set quoteUsage(v) { this._quoteUsage = v; }
  
  get starterUsage() { return this._starterUsage; }
  set starterUsage(v) { this._starterUsage = v; }
  
  get complimentUsage() { return this._complimentUsage; }
  set complimentUsage(v) { this._complimentUsage = v; }
  
  get userDigests() { return this._userDigests; }
  set userDigests(v) { this._userDigests = v; }
  
  get realive() { return this._realive; }
  set realive(v) { this._realive = v; }
  
  get summaryUsage() { return this._summaryUsage; }
  set summaryUsage(v) { this._summaryUsage = v; }
}

/**
 * Global bot state instance
 * @type {BotState}
 */
export const state = new BotState();

// ============================================================================
// STATE PERSISTENCE
// ============================================================================

/** Flag to prevent concurrent save operations */
let isSaving = false;

/** Flag to indicate a save is pending */
let savePending = false;

/**
 * Save all bot state to database
 * Implements debouncing to prevent excessive writes
 * @returns {Promise<void>}
 */
export async function saveStateToFile() {
  if (isSaving) {
    savePending = true;
    return;
  }
  
  isSaving = true;

  try {
    const savePromises = [];

    // User settings
    for (const [userId, settings] of Object.entries(state.userSettings)) {
      savePromises.push(
        db.saveUserSettings(userId, settings).catch(err => 
          console.error(`Failed to save user settings for ${userId}:`, err.message)
        )
      );
    }

    // Server settings
    for (const [guildId, settings] of Object.entries(state.serverSettings)) {
      savePromises.push(
        db.saveServerSettings(guildId, settings).catch(err => 
          console.error(`Failed to save server settings for ${guildId}:`, err.message)
        )
      );
    }

    // Chat histories
    for (const [id, history] of Object.entries(state.chatHistories)) {
      savePromises.push(
        db.saveChatHistory(id, history).catch(err => 
          console.error(`Failed to save chat history for ${id}:`, err.message)
        )
      );
    }

    // Custom instructions
    for (const [id, instructions] of Object.entries(state.customInstructions)) {
      savePromises.push(
        db.saveCustomInstructions(id, instructions).catch(err => 
          console.error(`Failed to save custom instructions for ${id}:`, err.message)
        )
      );
    }

    // Blacklisted users
    for (const [guildId, users] of Object.entries(state.blacklistedUsers)) {
      savePromises.push(
        db.saveBlacklistedUsers(guildId, users).catch(err => 
          console.error(`Failed to save blacklist for ${guildId}:`, err.message)
        )
      );
    }

    // Channel settings
    for (const [channelId, value] of Object.entries(state.alwaysRespondChannels)) {
      savePromises.push(
        db.saveChannelSetting(channelId, 'alwaysRespond', value).catch(err => 
          console.error(`Failed to save channel setting for ${channelId}:`, err.message)
        )
      );
    }
    for (const [channelId, value] of Object.entries(state.channelWideChatHistory)) {
      savePromises.push(
        db.saveChannelSetting(channelId, 'wideChatHistory', value).catch(err => 
          console.error(`Failed to save channel setting for ${channelId}:`, err.message)
        )
      );
    }
    for (const [channelId, value] of Object.entries(state.continuousReplyChannels)) {
      savePromises.push(
        db.saveChannelSetting(channelId, 'continuousReply', value).catch(err => 
          console.error(`Failed to save channel setting for ${channelId}:`, err.message)
        )
      );
    }

    // User response preferences
    for (const [userId, preference] of Object.entries(state.userResponsePreference)) {
      savePromises.push(
        db.saveUserResponsePreference(userId, preference).catch(err => 
          console.error(`Failed to save response preference for ${userId}:`, err.message)
        )
      );
    }

    // Image usage
    for (const [userId, usage] of Object.entries(state.imageUsage)) {
      savePromises.push(
        db.saveImageUsage(userId, usage).catch(err => 
          console.error(`Failed to save image usage for ${userId}:`, err.message)
        )
      );
    }

    // Birthdays
    for (const [userId, data] of Object.entries(state.birthdays)) {
      savePromises.push(
        db.saveBirthday(userId, data).catch(err => 
          console.error(`Failed to save birthday for ${userId}:`, err.message)
        )
      );
    }

    // Roulette configurations
    for (const [channelId, config] of Object.entries(state.roulette)) {
      savePromises.push(
        db.saveRouletteConfig(channelId, config).catch(err => 
          console.error(`Failed to save roulette config for ${channelId}:`, err.message)
        )
      );
    }

    // Daily quotes
    for (const [userId, config] of Object.entries(state.dailyQuotes)) {
      savePromises.push(
        db.saveDailyQuote(userId, config).catch(err => 
          console.error(`Failed to save daily quote for ${userId}:`, err.message)
        )
      );
    }

    // Compliment counts
    for (const [userId, count] of Object.entries(state.complimentCounts)) {
      savePromises.push(
        db.saveComplimentCount(userId, count).catch(err => 
          console.error(`Failed to save compliment count for ${userId}:`, err.message)
        )
      );
    }

    // User timezones
    for (const [userId, timezone] of Object.entries(state.userTimezones)) {
      savePromises.push(
        db.saveUserTimezone(userId, timezone).catch(err => 
          console.error(`Failed to save timezone for ${userId}:`, err.message)
        )
      );
    }

    // Server digests
    for (const [guildId, digest] of Object.entries(state.serverDigests)) {
      savePromises.push(
        db.saveServerDigest(guildId, digest).catch(err => 
          console.error(`Failed to save server digest for ${guildId}:`, err.message)
        )
      );
    }

    // Quote usage
    for (const [userId, usage] of Object.entries(state.quoteUsage)) {
      savePromises.push(
        db.saveQuoteUsage(userId, usage).catch(err => 
          console.error(`Failed to save quote usage for ${userId}:`, err.message)
        )
      );
    }

    // Realive configurations
    for (const [guildId, config] of Object.entries(state.realive)) {
      savePromises.push(
        db.saveRealiveConfig(guildId, config).catch(err => 
          console.error(`Failed to save realive config for ${guildId}:`, err.message)
        )
      );
    }
    
    // Summary usage
    for (const [userId, usage] of Object.entries(state.summaryUsage)) {
      savePromises.push(
        db.saveSummaryUsage(userId, usage).catch(err => 
          console.error(`Failed to save summary usage for ${userId}:`, err.message)
        )
      );
    }

    // Active users in channels
    savePromises.push(
      db.saveActiveUsersInChannels(state.activeUsersInChannels).catch(err => 
        console.error('Failed to save active users:', err.message)
      )
    );

    // Execute all saves in parallel
    await Promise.all(savePromises);
    
  } catch (error) {
    console.error('Critical error during state save:', error);
  } finally {
    isSaving = false;
    
    // Process pending save if one was requested during this save
    if (savePending) {
      savePending = false;
      // Use setImmediate to prevent stack overflow
      setImmediate(() => saveStateToFile());
    }
  }
}

/**
 * Load all bot state from database
 * @returns {Promise<void>}
 */
async function loadStateFromDB() {
  try {
    // Ensure temp directory exists
    await fs.mkdir(TEMP_DIR, { recursive: true });

    // Load all state in parallel
    const [
      chatHistories,
      userSettings,
      serverSettings,
      customInstructions,
      blacklistedUsers,
      userResponsePreference,
      activeUsersInChannels,
      imageUsage,
      birthdays,
      reminders,
      dailyQuotes,
      roulette,
      complimentCounts,
      complimentOptOut,
      userTimezones,
      serverDigests,
      quoteUsage,
      realive,
      summaryUsage
    ] = await Promise.all([
      db.getAllChatHistories(),
      db.getAllUserSettings(),
      db.getAllServerSettings(),
      db.getAllCustomInstructions(),
      db.getAllBlacklistedUsers(),
      db.getAllUserResponsePreferences(),
      db.getActiveUsersInChannels(),
      db.getAllImageUsages(),
      db.getAllBirthdays(),
      db.getAllReminders(),
      db.getAllDailyQuotes(),
      db.getAllRouletteConfigs(),
      db.getAllComplimentCounts(),
      db.getAllComplimentOptOuts(),
      db.getAllUserTimezones(),
      db.getAllServerDigests(),
      db.getAllQuoteUsages(),
      db.getAllRealiveConfigs(),
      db.getAllSummaryUsages()
    ]);

    // Assign loaded data to state
    state.chatHistories = chatHistories;
    state.userSettings = userSettings;
    state.serverSettings = serverSettings;
    state.customInstructions = customInstructions;
    state.blacklistedUsers = blacklistedUsers;
    state.userResponsePreference = userResponsePreference;
    state.activeUsersInChannels = activeUsersInChannels;
    state.imageUsage = imageUsage;
    state.birthdays = birthdays;
    state.reminders = reminders;
    state.dailyQuotes = dailyQuotes;
    state.roulette = roulette;
    state.complimentCounts = complimentCounts;
    state.complimentOptOut = complimentOptOut;
    state.userTimezones = userTimezones;
    state.serverDigests = serverDigests;
    state.quoteUsage = quoteUsage;
    state.realive = realive;
    state.summaryUsage = summaryUsage;

    // Load channel settings
    state.alwaysRespondChannels = await db.getAllChannelSettings('alwaysRespond');
    state.channelWideChatHistory = await db.getAllChannelSettings('wideChatHistory');
    state.continuousReplyChannels = await db.getAllChannelSettings('continuousReply');

    console.log('✅ Bot state loaded successfully from database');

  } catch (error) {
    console.error('❌ Critical error loading state from database:', error);
    throw error;
  }
}

// ============================================================================
// HISTORY MANAGEMENT
// ============================================================================

/**
 * Get formatted chat history for a user/channel/guild
 * @param {string} id - User/channel/guild ID
 * @param {string|null} [guildId] - Optional guild ID for server-wide history
 * @returns {Array} Formatted history for Gemini API
 */
export function getHistory(id, guildId = null) {
  const historyObject = state.chatHistories[id] || {};
  let combinedHistory = [];

  // Include guild history if applicable
  if (guildId && state.chatHistories[guildId]) {
    const guildHistory = state.chatHistories[guildId] || {};
    for (const messagesId in guildHistory) {
      if (Object.prototype.hasOwnProperty.call(guildHistory, messagesId)) {
        combinedHistory = [...combinedHistory, ...guildHistory[messagesId]];
      }
    }
  }

  // Add user/channel specific history
  for (const messagesId in historyObject) {
    if (Object.prototype.hasOwnProperty.call(historyObject, messagesId)) {
      combinedHistory = [...combinedHistory, ...historyObject[messagesId]];
    }
  }

  // Sort by timestamp
  combinedHistory.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  // Limit to maximum messages
  if (combinedHistory.length > STATE_CONFIG.MAX_MESSAGES) {
    combinedHistory = combinedHistory.slice(-STATE_CONFIG.MAX_MESSAGES);
  }

  // Format for API
  const apiHistory = [];
  let previousTimestamp = null;

  for (const entry of combinedHistory) {
    const apiEntry = {
      role: entry.role === 'assistant' ? 'model' : entry.role,
      parts: []
    };

    // Add time elapsed context if significant gap
    if (previousTimestamp) {
      const timeDiffMs = entry.timestamp - previousTimestamp;
      if (timeDiffMs > STATE_CONFIG.CONTEXT_BREAK_THRESHOLD) {
        const durationString = formatDuration(timeDiffMs);
        apiEntry.parts.push({
          text: `[TIME ELAPSED: ${durationString} since the previous turn]\n`
        });
      }
    }
    previousTimestamp = entry.timestamp;

    let userInfoAdded = false;

    if (Array.isArray(entry.content)) {
      for (const part of entry.content) {
        if (part.text !== undefined) {
          let textVal = part.text;
          
          // Add user info to first text part
          if (!userInfoAdded && entry.role === 'user' && entry.username && entry.displayName) {
            textVal = `[${entry.displayName} (@${entry.username})]: ${textVal}`;
            userInfoAdded = true;
          }
          
          apiEntry.parts.push({ text: textVal });
        } else if (part.fileUri) {
          const mime = part.mimeType || 'media';
          apiEntry.parts.push({
            text: `[Attachment: Previous file (${mime}) - Content no longer available to vision model]`
          });
        } else if (part.inlineData) {
          apiEntry.parts.push({
            text: `[Attachment: Previous inline image]`
          });
        }
      }
    }

    if (apiEntry.parts.length > 0) {
      apiHistory.push(apiEntry);
    }
  }

  return apiHistory;
}

/**
 * Update chat history with new messages
 * @param {string} id - User/channel/guild ID
 * @param {Array} newHistory - New history entries
 * @param {string} messagesId - Message identifier
 * @param {string|null} [username] - Username
 * @param {string|null} [displayName] - Display name
 */
export function updateChatHistory(id, newHistory, messagesId, username = null, displayName = null) {
  if (!state.chatHistories[id]) {
    state.chatHistories[id] = {};
  }

  if (!state.chatHistories[id][messagesId]) {
    state.chatHistories[id][messagesId] = [];
  }

  const historyWithUserInfo = newHistory.map(entry => {
    const baseEntry = {
      ...entry,
      timestamp: entry.timestamp || Date.now()
    };

    if (entry.role === 'user' && (username || displayName)) {
      return {
        ...baseEntry,
        userId: messagesId,
        username: username,
        displayName: displayName
      };
    }

    return baseEntry;
  });

  state.chatHistories[id][messagesId] = [
    ...state.chatHistories[id][messagesId],
    ...historyWithUserInfo
  ];
}

/**
 * Format duration in human-readable form
 * @param {number} milliseconds - Duration in milliseconds
 * @returns {string} Formatted duration
 */
function formatDuration(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  return `${seconds} second${seconds > 1 ? 's' : ''}`;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get user's response format preference
 * @param {string} userId - User ID
 * @returns {string} Response format ('Normal' or 'Embedded')
 */
export function getUserResponsePreference(userId) {
  return state.userResponsePreference[userId] || config.defaultResponseFormat;
}

/**
 * Initialize blacklist and default settings for a guild
 * @param {string} guildId - Guild ID
 */
export function initializeBlacklistForGuild(guildId) {
  try {
    if (!state.blacklistedUsers[guildId]) {
      state.blacklistedUsers[guildId] = [];
    }
    
    if (!state.serverSettings[guildId]) {
      state.serverSettings[guildId] = {
        selectedModel: 'gemini-2.5-flash',
        responseFormat: 'Normal',
        showActionButtons: false,
        continuousReply: false,
        customPersonality: null,
        embedColor: config.hexColour,
        overrideUserSettings: true,
        serverChatHistory: false,
        allowedChannels: []
      };
    } else {
      // Ensure all required fields exist
      if (!state.serverSettings[guildId].allowedChannels) {
        state.serverSettings[guildId].allowedChannels = [];
      }
      if (state.serverSettings[guildId].showActionButtons === undefined) {
        state.serverSettings[guildId].showActionButtons = false;
      }
      if (state.serverSettings[guildId].continuousReply === undefined) {
        state.serverSettings[guildId].continuousReply = true;
      }
    }
  } catch (error) {
    console.error(`Error initializing guild ${guildId}:`, error);
  }
}

/**
 * Check if user has exceeded image generation rate limit
 * @param {string} userId - User ID
 * @returns {{allowed: boolean, message?: string}} Rate limit status
 */
export function checkImageRateLimit(userId) {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ONE_MINUTE = 60 * 1000;

  if (!state.imageUsage[userId]) {
    state.imageUsage[userId] = {
      count: 0,
      lastReset: now,
      lastRequest: 0
    };
  }

  const usage = state.imageUsage[userId];

  // Reset daily counter
  if (now - usage.lastReset > ONE_DAY) {
    usage.count = 0;
    usage.lastReset = now;
  }

  // Check per-minute rate limit
  if (now - usage.lastRequest < ONE_MINUTE) {
    const waitSeconds = Math.ceil((ONE_MINUTE - (now - usage.lastRequest)) / 1000);
    return {
      allowed: false,
      message: `⏳ Please wait ${waitSeconds}s before generating another image.`
    };
  }

  // Check daily limit
  const limit = config.imageConfig?.maxPerDay || 10;
  if (usage.count >= limit) {
    return {
      allowed: false,
      message: `🛑 You've reached your daily limit of ${limit} images. Limits reset daily.`
    };
  }

  return { allowed: true };
}

/**
 * Increment image usage counter for user
 * @param {string} userId - User ID
 */
export function incrementImageUsage(userId) {
  const now = Date.now();
  
  if (!state.imageUsage[userId]) {
    state.imageUsage[userId] = {
      count: 0,
      lastReset: now,
      lastRequest: 0
    };
  }

  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (now - state.imageUsage[userId].lastReset > ONE_DAY) {
    state.imageUsage[userId].count = 0;
    state.imageUsage[userId].lastReset = now;
  }

  state.imageUsage[userId].count++;
  state.imageUsage[userId].lastRequest = now;
}

/**
 * Check if user has exceeded summary generation rate limit
 * @param {string} userId - User ID
 * @returns {{allowed: boolean, message?: string}} Rate limit status
 */
export function checkSummaryRateLimit(userId) {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const LIMIT = 10;

  if (!state.summaryUsage[userId]) {
    state.summaryUsage[userId] = {
      count: 0,
      lastReset: now
    };
  }

  const usage = state.summaryUsage[userId];

  // Reset daily counter
  if (now - usage.lastReset > ONE_DAY) {
    usage.count = 0;
    usage.lastReset = now;
  }

  // Check daily limit
  if (usage.count >= LIMIT) {
    return {
      allowed: false,
      message: `🛑 You've reached your daily limit of ${LIMIT} summaries. Limits reset daily.`
    };
  }

  return { allowed: true };
}

/**
 * Increment summary usage counter for user
 * @param {string} userId - User ID
 */
export function incrementSummaryUsage(userId) {
  const now = Date.now();
  
  if (!state.summaryUsage[userId]) {
    state.summaryUsage[userId] = {
      count: 0,
      lastReset: now
    };
  }

  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (now - state.summaryUsage[userId].lastReset > ONE_DAY) {
    state.summaryUsage[userId].count = 0;
    state.summaryUsage[userId].lastReset = now;
  }

  state.summaryUsage[userId].count++;
}

/**
 * Preserve attachment context in chat histories
 * Replaces file references with text descriptions to prevent 403 errors
 * @param {Object} histories - Chat histories object
 */
function preserveAttachmentContext(histories) {
  try {
    Object.values(histories).forEach(subIdEntries => {
      if (typeof subIdEntries === 'object' && subIdEntries !== null) {
        Object.values(subIdEntries).forEach(messages => {
          if (Array.isArray(messages)) {
            messages.forEach(message => {
              if (message.content) {
                message.content = message.content.map(contentItem => {
                  if (contentItem.fileData || contentItem.fileUri) {
                    const mimeType = contentItem.mimeType || contentItem.fileData?.mimeType || 'unknown';
                    const fileName = contentItem.fileName || 'attachment';

                    let fileType = 'File';
                    if (mimeType.startsWith('image/')) fileType = 'Image';
                    else if (mimeType.startsWith('video/')) fileType = 'Video';
                    else if (mimeType.startsWith('audio/')) fileType = 'Audio';
                    else if (mimeType.includes('pdf')) fileType = 'PDF';

                    return {
                      text: `[${fileType} was attached: ${fileName} (${mimeType})]`
                    };
                  }
                  return contentItem;
                });
              }
            });
          }
        });
      }
    });
  } catch (error) {
    console.error('Error preserving attachment context:', error);
  }
}

/**
 * Schedule daily reset for rate limits and usage counters
 */
function scheduleDailyReset() {
  try {
    const now = new Date();
    const nextReset = new Date();
    nextReset.setHours(RESOURCE_CONFIG.DAILY_RESET_HOUR, 0, 0, 0);
    
    if (nextReset <= now) {
      nextReset.setDate(now.getDate() + 1);
    }
    
    const timeUntilNextReset = nextReset - now;

    setTimeout(async () => {
      await chatHistoryLock.runExclusive(async () => {
        console.log('🔄 Executing daily reset...');
        
        // Preserve attachment context before reset
        preserveAttachmentContext(state.chatHistories);

        const currentMs = Date.now();
        
        // Reset image usage counters
        for (const userId in state.imageUsage) {
          state.imageUsage[userId].count = 0;
          state.imageUsage[userId].lastReset = currentMs;
        }

        // Reset summary usage counters
        for (const userId in state.summaryUsage) {
          state.summaryUsage[userId].count = 0;
          state.summaryUsage[userId].lastReset = currentMs;
        }

        await saveStateToFile();
        console.log('✅ Daily reset completed successfully');
      });
      
      // Schedule next reset
      scheduleDailyReset();
    }, timeUntilNextReset);

    console.log(`⏰ Daily reset scheduled for ${nextReset.toISOString()}`);
  } catch (error) {
    console.error('Error scheduling daily reset:', error);
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize bot manager
 * - Connect to database
 * - Load state
 * - Schedule periodic tasks
 * - Set up cleanup handlers
 * @returns {Promise<void>}
 */
export async function initialize() {
  try {
    console.log('🚀 Initializing Bot Manager...');
    
    // Validate environment
    if (!token) {
      throw new Error('DISCORD_BOT_TOKEN not found in environment variables');
    }

    // Connect to database
    await db.connectDB();
    console.log('✅ Database connected');

    // Load bot state
    await loadStateFromDB();
    console.log('✅ State loaded');

    // Schedule daily reset
    scheduleDailyReset();
    console.log('✅ Daily reset scheduled');

    // Schedule periodic state saves
    setInterval(async () => {
      try {
        await saveStateToFile();
        console.log('💾 Periodic state save completed');
      } catch (error) {
        console.error('❌ Periodic state save failed:', error);
      }
    }, RESOURCE_CONFIG.STATE_SAVE_INTERVAL);

    // Schedule periodic statistics logging
    setInterval(() => {
      console.log('📊 API Key Statistics Report');
      console.table(getApiKeyStats().keys.map(k => ({
        Key: k.keyNumber,
        Status: k.status,
        Requests: k.totalRequests,
        Success: k.successfulRequests,
        Errors: k.errors,
        Current: k.isCurrent ? '⭐' : ''
      })));
    }, RESOURCE_CONFIG.STATS_LOG_INTERVAL);

    // Display startup statistics
    console.log('📊 Startup Statistics:');
    console.log(JSON.stringify(getApiKeyStats(), null, 2));
    
    console.log('✅ Bot Manager initialized successfully');
  } catch (error) {
    console.error('❌ Critical error during initialization:', error);
    throw error;
  }
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

/**
 * Perform graceful shutdown
 * @param {string} signal - Signal that triggered shutdown
 */
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}, performing graceful shutdown...`);
  
  try {
    // Save final state
    console.log('💾 Saving final state...');
    await saveStateToFile();
    console.log('✅ State saved successfully');
    
    // Close database connection
    console.log('🔌 Closing database connection...');
    await db.closeDB();
    console.log('✅ Database connection closed');
    
    // Display final statistics
    console.log('📊 Shutdown Statistics:');
    console.log(JSON.stringify(getApiKeyStats(), null, 2));
    
    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  client,
  token,
  genAI,
  state,
  initialize,
  saveStateToFile,
  getHistory,
  updateChatHistory,
  getApiKeyStats,
  checkImageRateLimit,
  incrementImageUsage,
  checkSummaryRateLimit,
  incrementSummaryUsage,
  switchToNextKeyOrModel,
  switchToNextKey,
  createPartFromUri,
  getUserResponsePreference,
  initializeBlacklistForGuild,
  chatHistoryLock,
  requestQueues,
  TEMP_DIR
};
