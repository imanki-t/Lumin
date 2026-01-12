import dotenv from 'dotenv';
dotenv.config();

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import * as db from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const TEMP_DIR = path.join(__dirname, 'temp');

const RATE_LIMIT_CONFIG = Object.freeze({
  REQUESTS_PER_MINUTE: 15,
  WINDOW_DURATION_MS: 60000,
  COOLDOWN_DURATION_MS: 60000,
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAYS: Object.freeze({
    FORBIDDEN: 3000,
    RATE_LIMIT: 2500,
    SERVER_ERROR: 1000,
    DEFAULT: 1000
  })
});

const RETRY_STRATEGY = Object.freeze({
  MAX_ATTEMPTS_PER_KEY: 3,
  AGGRESSIVE_ROTATION: true
});

const RESOURCE_CONFIG = Object.freeze({
  STATE_SAVE_INTERVAL: 300000,
  STATS_LOG_INTERVAL: 900000,
  MAX_CACHE_SIZE: 1000,
  FILE_CLEANUP_AGE: 3600000,
  DAILY_RESET_HOUR: 0
});

const STATE_CONFIG = Object.freeze({
  MAX_MESSAGES: 50,
  CONTEXT_BREAK_THRESHOLD: 1800000,
  MAX_QUEUE_SIZE: 5
});

const MODEL_FALLBACK_CHAIN = Object.freeze([
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite'
]);

const DEFAULT_SERVER_SETTINGS = Object.freeze({
  selectedModel: 'gemini-2.5-flash',
  responseFormat: 'Normal',
  showActionButtons: false,
  continuousReply: false,
  customPersonality: null,
  embedColor: config.hexColour,
  overrideUserSettings: true,
  serverChatHistory: false,
  allowedChannels: []
});

const DEFAULT_USER_SETTINGS = Object.freeze({
  selectedModel: 'gemini-2.5-flash',
  responseFormat: 'Normal',
  showActionButtons: false,
  continuousReply: true,
  customPersonality: null,
  embedColor: config.hexColour
});

const DEFAULT_IMAGE_USAGE = Object.freeze({
  count: 0,
  lastReset: Date.now(),
  lastRequest: 0
});

const DEFAULT_SUMMARY_USAGE = Object.freeze({
  count: 0,
  lastReset: Date.now()
});

const RATE_LIMITS = Object.freeze({
  IMAGE_PER_DAY: 10,
  IMAGE_PER_MINUTE: 60000,
  SUMMARY_PER_DAY: 10
});

const TIME_CONSTANTS = Object.freeze({
  ONE_DAY: 86400000,
  ONE_HOUR: 3600000,
  ONE_MINUTE: 60000
});

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

export const token = process.env.DISCORD_BOT_TOKEN;

function loadApiKeys() {
  const keys = [];
  let keyIndex = 1;

  while (process.env[`GOOGLE_API_KEY${keyIndex}`]) {
    const key = process.env[`GOOGLE_API_KEY${keyIndex}`];
    if (validateApiKey(key)) {
      keys.push(key);
    } else {
      console.warn(`⚠️ Invalid API key format at GOOGLE_API_KEY${keyIndex}`);
    }
    keyIndex++;
  }

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

  return keys;
}

function validateApiKey(key) {
  return typeof key === 'string' && key.length > 20 && !key.includes(' ');
}

const apiKeys = loadApiKeys();
const MAX_TOTAL_ATTEMPTS = Math.max(3, apiKeys.length * 3);

let currentKeyIdx = 0;
let currentClient = new GoogleGenAI({ apiKey: apiKeys[currentKeyIdx] });

const keyUsageStats = new Map();
const keyErrorTracking = new Map();
const keyCooldowns = new Map();
const keyModelRateLimits = new Map();
const keyModelCooldowns = new Map();

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

function isModelRateLimited(keyIdx, modelName) {
  const modelLimits = keyModelRateLimits.get(keyIdx);
  if (!modelLimits) return false;

  const rateLimitData = modelLimits.get(modelName);
  if (!rateLimitData) return false;

  const now = Date.now();
  const elapsed = now - rateLimitData.windowStart;

  if (elapsed >= RATE_LIMIT_CONFIG.WINDOW_DURATION_MS) {
    rateLimitData.count = 0;
    rateLimitData.windowStart = now;
    modelLimits.set(modelName, rateLimitData);
    return false;
  }

  return rateLimitData.count >= RATE_LIMIT_CONFIG.REQUESTS_PER_MINUTE;
}

function incrementModelRateLimit(keyIdx, modelName) {
  const modelLimits = keyModelRateLimits.get(keyIdx);
  if (!modelLimits) return;

  let rateLimitData = modelLimits.get(modelName);
  const now = Date.now();

  if (!rateLimitData) {
    rateLimitData = { count: 1, windowStart: now };
    modelLimits.set(modelName, rateLimitData);
    return;
  }

  const elapsed = now - rateLimitData.windowStart;

  if (elapsed >= RATE_LIMIT_CONFIG.WINDOW_DURATION_MS) {
    rateLimitData.count = 1;
    rateLimitData.windowStart = now;
  } else {
    rateLimitData.count++;
  }

  modelLimits.set(modelName, rateLimitData);
}

function setModelCooldown(keyIdx, modelName, cooldownMs = RATE_LIMIT_CONFIG.COOLDOWN_DURATION_MS) {
  const modelCooldowns = keyModelCooldowns.get(keyIdx);
  if (!modelCooldowns) return;

  const cooldownUntil = Date.now() + cooldownMs;
  modelCooldowns.set(modelName, cooldownUntil);
}

function isModelOnCooldown(keyIdx, modelName) {
  const modelCooldowns = keyModelCooldowns.get(keyIdx);
  if (!modelCooldowns) return false;

  const cooldownUntil = modelCooldowns.get(modelName) || 0;
  return Date.now() < cooldownUntil;
}

function findAvailableModel(currentModelName) {
  const currentModelIdx = MODEL_FALLBACK_CHAIN.indexOf(currentModelName);
  
  for (let i = 1; i < MODEL_FALLBACK_CHAIN.length; i++) {
    const testModelIdx = (currentModelIdx + i) % MODEL_FALLBACK_CHAIN.length;
    const testModelName = MODEL_FALLBACK_CHAIN[testModelIdx];
    
    if (isModelOnCooldown(currentKeyIdx, testModelName)) continue;
    if (isModelRateLimited(currentKeyIdx, testModelName)) continue;
    
    return testModelName;
  }
  
  return null;
}

function findAvailableKey() {
  const now = Date.now();
  
  for (let i = 1; i <= apiKeys.length; i++) {
    const testIdx = (currentKeyIdx + i) % apiKeys.length;
    const cooldownUntil = keyCooldowns.get(testIdx) || 0;
    
    if (now < cooldownUntil) continue;
    
    return testIdx;
  }
  
  return null;
}

export function switchToNextKeyOrModel(error, currentModelName) {
  const oldKeyIdx = currentKeyIdx;
  
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

  if (isFileError) {
    return { keyRotated: false, modelChanged: false, newModel: null };
  }

  if (isRateLimit) {
    setModelCooldown(oldKeyIdx, currentModelName);
    
    const nextModel = findAvailableModel(currentModelName);
    
    if (nextModel) {
      return { keyRotated: false, modelChanged: true, newModel: nextModel };
    }
    
    const nextKeyIdx = findAvailableKey();
    
    if (nextKeyIdx !== null && nextKeyIdx !== oldKeyIdx) {
      currentKeyIdx = nextKeyIdx;
      currentClient = new GoogleGenAI({ apiKey: apiKeys[currentKeyIdx] });
      return { keyRotated: true, modelChanged: false, newModel: currentModelName };
    }
    
    const fallbackIdx = (MODEL_FALLBACK_CHAIN.indexOf(currentModelName) + 1) % MODEL_FALLBACK_CHAIN.length;
    const fallbackModel = MODEL_FALLBACK_CHAIN[fallbackIdx];
    return { keyRotated: false, modelChanged: true, newModel: fallbackModel };
  }
  
  const tracking = keyErrorTracking.get(oldKeyIdx);
  if (tracking) {
    tracking.lastError = {
      message: error?.message || 'Unknown error',
      timestamp: new Date().toISOString()
    };
  }
  
  return { keyRotated: false, modelChanged: false, newModel: null };
}

export function switchToNextKey(error) {
  const result = switchToNextKeyOrModel(error, 'gemini-2.5-flash');
  return result.keyRotated || result.modelChanged;
}

async function withRetryPerModel(apiCall, initialModelName) {
  let totalAttempts = 0;
  let currentModel = initialModelName;
  
  const attemptsPerKey = new Map();
  apiKeys.forEach((_, idx) => attemptsPerKey.set(idx, 0));

  while (totalAttempts < MAX_TOTAL_ATTEMPTS) {
    const currentKey = currentKeyIdx;
    const keyAttempts = attemptsPerKey.get(currentKey) || 0;
    
    try {
      if (isModelRateLimited(currentKeyIdx, currentModel)) {
        const nextModel = findAvailableModel(currentModel);
        
        if (nextModel) {
          currentModel = nextModel;
          totalAttempts++;
          continue;
        } else {
          const nextKeyIdx = findAvailableKey();
          
          if (nextKeyIdx !== null && nextKeyIdx !== currentKeyIdx) {
            currentKeyIdx = nextKeyIdx;
            currentClient = new GoogleGenAI({ apiKey: apiKeys[currentKeyIdx] });
            currentModel = initialModelName;
            attemptsPerKey.set(currentKeyIdx, 0);
            totalAttempts++;
            continue;
          }
        }
        
        totalAttempts++;
        continue;
      }

      const stats = keyUsageStats.get(currentKeyIdx);
      if (stats) {
        stats.requests++;
        stats.lastUsed = Date.now();
      }

      incrementModelRateLimit(currentKeyIdx, currentModel);

      const result = await apiCall(currentModel);

      if (stats) {
        stats.successfulRequests++;
      }

      return result;

    } catch (error) {
      totalAttempts++;
      attemptsPerKey.set(currentKey, keyAttempts + 1);
      
      const stats = keyUsageStats.get(currentKeyIdx);
      if (stats) {
        stats.errors++;
      }

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

      if (isFileError) {
        if (totalAttempts >= MAX_TOTAL_ATTEMPTS) {
          throw new Error(`File permission error persists: ${error.message}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      if (isRateLimit) {
        const nextModel = findAvailableModel(currentModel);
        
        if (nextModel) {
          currentModel = nextModel;
        } else {
          const nextKeyIdx = findAvailableKey();
          
          if (nextKeyIdx !== null && nextKeyIdx !== currentKeyIdx) {
            currentKeyIdx = nextKeyIdx;
            currentClient = new GoogleGenAI({ apiKey: apiKeys[currentKeyIdx] });
            currentModel = initialModelName;
            attemptsPerKey.set(currentKeyIdx, 0);
          } else {
            const fallbackIdx = (MODEL_FALLBACK_CHAIN.indexOf(currentModel) + 1) % MODEL_FALLBACK_CHAIN.length;
            currentModel = MODEL_FALLBACK_CHAIN[fallbackIdx];
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_CONFIG.RETRY_DELAYS.RATE_LIMIT));
        continue;
      }

      let shouldRotate = false;
      
      if (RETRY_STRATEGY.AGGRESSIVE_ROTATION && keyAttempts >= RETRY_STRATEGY.MAX_ATTEMPTS_PER_KEY - 1) {
        shouldRotate = true;
      }
      
      if (shouldRotate) {
        const nextKeyIdx = findAvailableKey();
        
        if (nextKeyIdx !== null && nextKeyIdx !== currentKeyIdx) {
          currentKeyIdx = nextKeyIdx;
          currentClient = new GoogleGenAI({ apiKey: apiKeys[currentKeyIdx] });
          attemptsPerKey.set(currentKeyIdx, 0);
        }
      }
      
      if (totalAttempts >= MAX_TOTAL_ATTEMPTS) {
        throw new Error(`All retry attempts exhausted (${MAX_TOTAL_ATTEMPTS} attempts). Last error: ${error.message}`);
      }
      
      const errorMessage = error.message || '';
      let delay = RATE_LIMIT_CONFIG.RETRY_DELAYS.DEFAULT;
      
      if (errorMessage.includes('403')) {
        delay = RATE_LIMIT_CONFIG.RETRY_DELAYS.FORBIDDEN;
      } else if (errorMessage.includes('429') || errorMessage.includes('quota')) {
        delay = RATE_LIMIT_CONFIG.RETRY_DELAYS.RATE_LIMIT;
      } else if (errorMessage.includes('500') || errorMessage.includes('503')) {
        delay = RATE_LIMIT_CONFIG.RETRY_DELAYS.SERVER_ERROR;
      }
      
      delay += Math.random() * 500;
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error(`Retry loop exited unexpectedly after ${totalAttempts} attempts`);
}

async function withRetry(apiCall) {
  return withRetryPerModel(
    async (modelName) => await apiCall(),
    'gemini-2.5-flash'
  );
}

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

export function createPartFromUri(fileUri, mimeType) {
  return {
    fileData: {
      fileUri: fileUri,
      mimeType: mimeType
    }
  };
}

export function getApiKeyStats() {
  const stats = [];
  const now = Date.now();
  
  apiKeys.forEach((key, idx) => {
    const keyStats = keyUsageStats.get(idx);
    const tracking = keyErrorTracking.get(idx);
    const cooldown = keyCooldowns.get(idx);
    const isOnCooldown = cooldown && now < cooldown;

    const modelStats = [];
    const modelLimits = keyModelRateLimits.get(idx);
    const modelCooldowns = keyModelCooldowns.get(idx);
    
    if (modelLimits) {
      MODEL_FALLBACK_CHAIN.forEach(modelName => {
        const limitData = modelLimits.get(modelName);
        const cooldownUntil = modelCooldowns?.get(modelName) || 0;
        const isModelCooldown = now < cooldownUntil;
        const isModelLimited = limitData && isModelRateLimited(idx, modelName);
        
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

export const requestQueues = new Map();

class Mutex {
  constructor() {
    this._locked = false;
    this._queue = [];
  }

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

  release() {
    if (this._queue.length > 0) {
      const nextResolve = this._queue.shift();
      nextResolve();
    } else {
      this._locked = false;
    }
  }

  async runExclusive(callback) {
    await this.acquire();
    try {
      return await callback();
    } finally {
      this.release();
    }
  }
}

export const chatHistoryLock = new Mutex();

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

export const state = new BotState();

let isSaving = false;
let savePending = false;

export async function saveStateToFile() {
  if (isSaving) {
    savePending = true;
    return;
  }
  
  isSaving = true;

  try {
    const savePromises = [];

    for (const [userId, settings] of Object.entries(state.userSettings)) {
      savePromises.push(
        db.saveUserSettings(userId, settings).catch(err => 
          console.error(`Failed to save user settings for ${userId}:`, err.message)
        )
      );
    }

    for (const [guildId, settings] of Object.entries(state.serverSettings)) {
      savePromises.push(
        db.saveServerSettings(guildId, settings).catch(err => 
          console.error(`Failed to save server settings for ${guildId}:`, err.message)
        )
      );
    }

    for (const [id, history] of Object.entries(state.chatHistories)) {
      savePromises.push(
        db.saveChatHistory(id, history).catch(err => 
          console.error(`Failed to save chat history for ${id}:`, err.message)
        )
      );
    }

    for (const [id, instructions] of Object.entries(state.customInstructions)) {
      savePromises.push(
        db.saveCustomInstructions(id, instructions).catch(err => 
          console.error(`Failed to save custom instructions for ${id}:`, err.message)
        )
      );
    }

    for (const [guildId, users] of Object.entries(state.blacklistedUsers)) {
      savePromises.push(
        db.saveBlacklistedUsers(guildId, users).catch(err => 
          console.error(`Failed to save blacklist for ${guildId}:`, err.message)
        )
      );
    }

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

    for (const [userId, preference] of Object.entries(state.userResponsePreference)) {
      savePromises.push(
        db.saveUserResponsePreference(userId, preference).catch(err => 
          console.error(`Failed to save response preference for ${userId}:`, err.message)
        )
      );
    }

    for (const [userId, usage] of Object.entries(state.imageUsage)) {
      savePromises.push(
        db.saveImageUsage(userId, usage).catch(err => 
          console.error(`Failed to save image usage for ${userId}:`, err.message)
        )
      );
    }

    for (const [userId, data] of Object.entries(state.birthdays)) {
      savePromises.push(
        db.saveBirthday(userId, data).catch(err => 
          console.error(`Failed to save birthday for ${userId}:`, err.message)
        )
      );
    }

    for (const [channelId, config] of Object.entries(state.roulette)) {
      savePromises.push(
        db.saveRouletteConfig(channelId, config).catch(err => 
          console.error(`Failed to save roulette config for ${channelId}:`, err.message)
        )
      );
    }

    for (const [userId, config] of Object.entries(state.dailyQuotes)) {
      savePromises.push(
        db.saveDailyQuote(userId, config).catch(err => 
          console.error(`Failed to save daily quote for ${userId}:`, err.message)
        )
      );
    }

    for (const [userId, count] of Object.entries(state.complimentCounts)) {
      savePromises.push(
        db.saveComplimentCount(userId, count).catch(err => 
          console.error(`Failed to save compliment count for ${userId}:`, err.message)
        )
      );
    }

    for (const [userId, timezone] of Object.entries(state.userTimezones)) {
      savePromises.push(
        db.saveUserTimezone(userId, timezone).catch(err => 
          console.error(`Failed to save timezone for ${userId}:`, err.message)
        )
      );
    }

    for (const [guildId, digest] of Object.entries(state.serverDigests)) {
      savePromises.push(
        db.saveServerDigest(guildId, digest).catch(err => 
          console.error(`Failed to save server digest for ${guildId}:`, err.message)
        )
      );
    }

    for (const [userId, usage] of Object.entries(state.quoteUsage)) {
      savePromises.push(
        db.saveQuoteUsage(userId, usage).catch(err => 
          console.error(`Failed to save quote usage for ${userId}:`, err.message)
        )
      );
    }

    for (const [guildId, config] of Object.entries(state.realive)) {
      savePromises.push(
        db.saveRealiveConfig(guildId, config).catch(err => 
          console.error(`Failed to save realive config for ${guildId}:`, err.message)
        )
      );
    }
    
    for (const [userId, usage] of Object.entries(state.summaryUsage)) {
      savePromises.push(
        db.saveSummaryUsage(userId, usage).catch(err => 
          console.error(`Failed to save summary usage for ${userId}:`, err.message)
        )
      );
    }

    savePromises.push(
      db.saveActiveUsersInChannels(state.activeUsersInChannels).catch(err => 
        console.error('Failed to save active users:', err.message)
      )
    );

    await Promise.all(savePromises);
    
  } catch (error) {
    console.error('Critical error during state save:', error);
  } finally {
    isSaving = false;
    
    if (savePending) {
      savePending = false;
      setImmediate(() => saveStateToFile());
    }
  }
}

async function loadStateFromDB() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });

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

    state.alwaysRespondChannels = await db.getAllChannelSettings('alwaysRespond');
    state.channelWideChatHistory = await db.getAllChannelSettings('wideChatHistory');
    state.continuousReplyChannels = await db.getAllChannelSettings('continuousReply');

    console.log('✅ Bot state loaded successfully from database');

  } catch (error) {
    console.error('❌ Critical error loading state from database:', error);
    throw error;
  }
}

export function getHistory(id, guildId = null) {
  const historyObject = state.chatHistories[id] || {};
  let combinedHistory = [];

  if (guildId && state.chatHistories[guildId]) {
    const guildHistory = state.chatHistories[guildId] || {};
    for (const messagesId in guildHistory) {
      if (Object.prototype.hasOwnProperty.call(guildHistory, messagesId)) {
        combinedHistory = [...combinedHistory, ...guildHistory[messagesId]];
      }
    }
  }

  for (const messagesId in historyObject) {
    if (Object.prototype.hasOwnProperty.call(historyObject, messagesId)) {
      combinedHistory = [...combinedHistory, ...historyObject[messagesId]];
    }
  }

  combinedHistory.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  if (combinedHistory.length > STATE_CONFIG.MAX_MESSAGES) {
    combinedHistory = combinedHistory.slice(-STATE_CONFIG.MAX_MESSAGES);
  }

  const apiHistory = [];
  let previousTimestamp = null;

  for (const entry of combinedHistory) {
    const apiEntry = {
      role: entry.role === 'assistant' ? 'model' : entry.role,
      parts: []
    };

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

export function getUserResponsePreference(userId) {
  return state.userResponsePreference[userId] || config.defaultResponseFormat;
}

export function initializeBlacklistForGuild(guildId) {
  try {
    if (!state.blacklistedUsers[guildId]) {
      state.blacklistedUsers[guildId] = [];
    }
    
    if (!state.serverSettings[guildId]) {
      state.serverSettings[guildId] = { ...DEFAULT_SERVER_SETTINGS };
    } else {
      if (!state.serverSettings[guildId].allowedChannels) {
        state.serverSettings[guildId].allowedChannels = [];
      }
      if (state.serverSettings[guildId].showActionButtons === undefined) {
        state.serverSettings[guildId].showActionButtons = false;
      }
      if (state.serverSettings[guildId].continuousReply === undefined) {
        state.serverSettings[guildId].continuousReply = false;
      }
    }
  } catch (error) {
    console.error(`Error initializing guild ${guildId}:`, error);
  }
}

export function checkImageRateLimit(userId) {
  const now = Date.now();

  if (!state.imageUsage[userId]) {
    state.imageUsage[userId] = { ...DEFAULT_IMAGE_USAGE };
  }

  const usage = state.imageUsage[userId];

  if (now - usage.lastReset > TIME_CONSTANTS.ONE_DAY) {
    usage.count = 0;
    usage.lastReset = now;
  }

  if (now - usage.lastRequest < RATE_LIMITS.IMAGE_PER_MINUTE) {
    const waitSeconds = Math.ceil((RATE_LIMITS.IMAGE_PER_MINUTE - (now - usage.lastRequest)) / 1000);
    return {
      allowed: false,
      message: `⏳ Please wait ${waitSeconds}s before generating another image.`
    };
  }

  if (usage.count >= RATE_LIMITS.IMAGE_PER_DAY) {
    return {
      allowed: false,
      message: `🛑 You've reached your daily limit of ${RATE_LIMITS.IMAGE_PER_DAY} images. Limits reset daily.`
    };
  }

  return { allowed: true };
}

export function incrementImageUsage(userId) {
  const now = Date.now();
  
  if (!state.imageUsage[userId]) {
    state.imageUsage[userId] = { ...DEFAULT_IMAGE_USAGE };
  }

  if (now - state.imageUsage[userId].lastReset > TIME_CONSTANTS.ONE_DAY) {
    state.imageUsage[userId].count = 0;
    state.imageUsage[userId].lastReset = now;
  }

  state.imageUsage[userId].count++;
  state.imageUsage[userId].lastRequest = now;
}

export function checkSummaryRateLimit(userId) {
  const now = Date.now();

  if (!state.summaryUsage[userId]) {
    state.summaryUsage[userId] = { ...DEFAULT_SUMMARY_USAGE };
  }

  const usage = state.summaryUsage[userId];

  if (now - usage.lastReset > TIME_CONSTANTS.ONE_DAY) {
    usage.count = 0;
    usage.lastReset = now;
  }

  if (usage.count >= RATE_LIMITS.SUMMARY_PER_DAY) {
    return {
      allowed: false,
      message: `🛑 You've reached your daily limit of ${RATE_LIMITS.SUMMARY_PER_DAY} summaries. Limits reset daily.`
    };
  }

  return { allowed: true };
}

export function incrementSummaryUsage(userId) {
  const now = Date.now();
  
  if (!state.summaryUsage[userId]) {
    state.summaryUsage[userId] = { ...DEFAULT_SUMMARY_USAGE };
  }

  if (now - state.summaryUsage[userId].lastReset > TIME_CONSTANTS.ONE_DAY) {
    state.summaryUsage[userId].count = 0;
    state.summaryUsage[userId].lastReset = now;
  }

  state.summaryUsage[userId].count++;
}

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
        preserveAttachmentContext(state.chatHistories);

        const currentMs = Date.now();
        
        for (const userId in state.imageUsage) {
          state.imageUsage[userId].count = 0;
          state.imageUsage[userId].lastReset = currentMs;
        }

        for (const userId in state.summaryUsage) {
          state.summaryUsage[userId].count = 0;
          state.summaryUsage[userId].lastReset = currentMs;
        }

        await saveStateToFile();
      });
      
      scheduleDailyReset();
    }, timeUntilNextReset);

  } catch (error) {
    console.error('Error scheduling daily reset:', error);
  }
}

export async function initialize() {
  try {
    if (!token) {
      throw new Error('DISCORD_BOT_TOKEN not found in environment variables');
    }

    await db.connectDB();
    await loadStateFromDB();
    
    scheduleDailyReset();

    setInterval(async () => {
      try {
        await saveStateToFile();
      } catch (error) {
        console.error('❌ Periodic state save failed:', error);
      }
    }, RESOURCE_CONFIG.STATE_SAVE_INTERVAL);

    setInterval(() => {
      const stats = getApiKeyStats();
      console.log(`\n📊 API Keys: ${stats.totalKeys} total, Current: Key ${stats.currentKey}, Capacity: ${stats.effectiveCapacity}`);
    }, RESOURCE_CONFIG.STATS_LOG_INTERVAL);

    const initStats = getApiKeyStats();
    console.log(`\n✅ Bot Manager Initialized\n📊 API Configuration: ${initStats.totalKeys} keys, ${initStats.rateLimit}, Total capacity: ${initStats.effectiveCapacity}`);
    
  } catch (error) {
    console.error('❌ Critical error during initialization:', error);
    throw error;
  }
}

async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}, performing graceful shutdown...`);
  
  try {
    await saveStateToFile();
    await db.closeDB();
    
    const finalStats = getApiKeyStats();
    console.log(`\n📊 Final Statistics: ${finalStats.keys.reduce((sum, k) => sum + k.totalRequests, 0)} total requests across ${finalStats.totalKeys} keys`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

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
