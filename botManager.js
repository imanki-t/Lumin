import dotenv from 'dotenv';
dotenv.config();
import {
Client,
GatewayIntentBits,
Partials
} from 'discord.js';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs/promises';
import path from 'path';
import {
fileURLToPath
} from 'url';

import config from './config.js';
import * as db from './database.js';

export const client = new Client({
intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.DirectMessages,
],
partials: [Partials.Channel],
});

const apiKeys = [];
let keyIndex = 1;

// Load all available keys from environment variables
while (process.env[`GOOGLE_API_KEY${keyIndex}`]) {
apiKeys.push(process.env[`GOOGLE_API_KEY${keyIndex}`]);
keyIndex++;
}

if (apiKeys.length === 0 && process.env.GOOGLE_API_KEY) {
apiKeys.push(process.env.GOOGLE_API_KEY);
}

let currentKeyIdx = 0;
const keyUsageStats = new Map();
const keyErrorTracking = new Map();
const keyCooldowns = new Map(); // Track keys currently on 429 cooldown
const keyRateLimits = new Map(); // Track requests per minute (15 req/min limit)

const RATE_LIMIT_PER_MINUTE = 15;
const RATE_LIMIT_WINDOW = 60000; // 1 minute in milliseconds

apiKeys.forEach((_, idx) => {
keyUsageStats.set(idx, { requests: 0, lastUsed: null, errors: 0, successfulRequests: 0 });
keyErrorTracking.set(idx, { lastError: null });
keyRateLimits.set(idx, { count: 0, windowStart: Date.now() });
});

let currentClient = new GoogleGenAI({ apiKey: apiKeys[0] });

/**
* Check if a key has exceeded rate limit (15 requests/minute)
*/
function isKeyRateLimited(keyIdx) {
const rateLimitData = keyRateLimits.get(keyIdx);
if (!rateLimitData) return false;

const now = Date.now();
const timeSinceWindowStart = now - rateLimitData.windowStart;

// Reset window if more than 1 minute has passed
if (timeSinceWindowStart >= RATE_LIMIT_WINDOW) {
rateLimitData.count = 0;
rateLimitData.windowStart = now;
keyRateLimits.set(keyIdx, rateLimitData);
return false;
}

// Check if limit exceeded
return rateLimitData.count >= RATE_LIMIT_PER_MINUTE;
}

/**
* Increment rate limit counter for a key
*/
function incrementRateLimit(keyIdx) {
const rateLimitData = keyRateLimits.get(keyIdx);
if (!rateLimitData) return;

const now = Date.now();
const timeSinceWindowStart = now - rateLimitData.windowStart;

// Reset window if more than 1 minute has passed
if (timeSinceWindowStart >= RATE_LIMIT_WINDOW) {
rateLimitData.count = 1;
rateLimitData.windowStart = now;
} else {
rateLimitData.count++;
}

keyRateLimits.set(keyIdx, rateLimitData);
}

/**
* Find next available key that's not rate limited or on cooldown
*/
function findAvailableKey() {
const now = Date.now();
  
for (let i = 0; i < apiKeys.length; i++) {
const testIdx = (currentKeyIdx + i) % apiKeys.length;
    
// Check cooldown
const cooldownUntil = keyCooldowns.get(testIdx) || 0;
if (now < cooldownUntil) {
  continue;
}
    
// Check rate limit
if (isKeyRateLimited(testIdx)) {
  continue;
}
    
return testIdx;
}
  
return null; // No available keys
}

/**
* Switches to the next available API key, skipping those on cooldown or rate limited.
*/
export function switchToNextKey(error) {
  
  const oldIdx = currentKeyIdx;

  // More accurate rate limit detection
  const isRateLimit = 
    error?.status === 429 ||
    error?.code === 'RESOURCE_EXHAUSTED' ||
    (error?.message?.includes('429') && !error?.message?.includes('File')) ||
    error?.message?.includes('RESOURCE_EXHAUSTED') ||
    error?.message?.includes('quota');

  // File permission errors should NOT trigger cooldown unless they are also rate limits
  const isFileError = 
    error?.message?.includes('PERMISSION_DENIED') && 
    (error?.message?.includes('File') || error?.message?.includes('file'));

  if (isRateLimit && !isFileError) {
    keyCooldowns.set(oldIdx, Date.now() + 60000);
    console.warn(`⏱️ Key ${oldIdx + 1} on 60s cooldown (rate limit)`);
  } else if (isFileError) {
    console.log(`📁 Key ${oldIdx + 1} rotated due to file permission issue.`);
  }

  // Find next available key
  const nextIdx = findAvailableKey();

  if (nextIdx !== null) {
    currentKeyIdx = nextIdx;
    console.log(`✅ Switched to Key ${nextIdx + 1}`);
  } else {
    console.warn(`⚠️ ALL keys on cooldown or rate limited! Using round-robin fallback...`);
    currentKeyIdx = (oldIdx + 1) % apiKeys.length;
  }

  // Only re-initialize and return TRUE if the key actually changed
  if (currentKeyIdx !== oldIdx) {
    currentClient = new GoogleGenAI({ apiKey: apiKeys[currentKeyIdx] });

    const tracking = keyErrorTracking.get(oldIdx);
    if (error && tracking) {
      tracking.lastError = {
        message: error.message || 'Unknown error',
        timestamp: new Date().toISOString()
      };
    }
    return true; // SIGNAL: Key was rotated
  }

  return false; // SIGNAL: Key stayed the same
}

async function withRetry(apiCall) {
  let attempts = 0;
  const maxAttempts = Math.max(3, apiKeys.length);

  while (attempts < maxAttempts) {
    try {
      // Check rate limit BEFORE making the call
      if (isKeyRateLimited(currentKeyIdx)) {
        console.warn(`⏱️ Key ${currentKeyIdx + 1} hit rate limit (${RATE_LIMIT_PER_MINUTE} req/min), switching...`);
        switchToNextKey({ message: 'Rate limit pre-check failed' });
        attempts++;
        continue;
      }

      const stats = keyUsageStats.get(currentKeyIdx);
      stats.requests++;
      stats.lastUsed = Date.now();

      // Increment rate limit counter
      incrementRateLimit(currentKeyIdx);

      const result = await apiCall();

      stats.successfulRequests++;
      return result;

    } catch (error) {
      const stats = keyUsageStats.get(currentKeyIdx);
      stats.errors++;

      const errorMessage = error.message || '';
      const is403Error = errorMessage.includes('403') || errorMessage.includes('Forbidden');
      const is429Error = errorMessage.includes('429') || errorMessage.includes('quota');
      const is500Error = errorMessage.includes('500') || errorMessage.includes('503');

      console.warn(`API call failed (Key Index: ${currentKeyIdx}): ${error.message}`);
      
      // Switch to next key immediately for quota/auth errors
      switchToNextKey(error);
      attempts++;

      if (attempts >= maxAttempts) {
        throw new Error(`All API keys failed. Last error: ${error.message}`);
      }
      
      // Reduced delay based on error type
      if (is403Error) {
        await new Promise(r => setTimeout(r, 3000));
      } else if (is429Error) {
        await new Promise(r => setTimeout(r, 2500));
      } else if (is500Error) {
        await new Promise(r => setTimeout(r, 1000));
      } else {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
}

export const genAI = new Proxy({}, {
get(target, prop) {
  if (prop === 'models') {
    return {
      generateContent: (request) => withRetry(() => currentClient.models.generateContent(request)),
      generateContentStream: (request) => withRetry(() => currentClient.models.generateContentStream(request)),
      embedContent: (request) => withRetry(() => currentClient.models.embedContent(request))
    };
  }

  if (prop === 'chats') {
    return {
      create: (config) => {
        const chat = currentClient.chats.create(config);
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

// Helper to create part from URI (standardized)
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
apiKeys.forEach((key, idx) => {
  const keyStats = keyUsageStats.get(idx);
  const tracking = keyErrorTracking.get(idx);
  const cooldown = keyCooldowns.get(idx);
  const rateLimit = keyRateLimits.get(idx);
  const isOnCooldown = cooldown && Date.now() < cooldown;
  const isRateLimited = isKeyRateLimited(idx);

  // Calculate time until rate limit resets
  const now = Date.now();
  const timeUntilReset = rateLimit ? 
    Math.max(0, RATE_LIMIT_WINDOW - (now - rateLimit.windowStart)) : 0;
  const secondsUntilReset = Math.ceil(timeUntilReset / 1000);

  let status = '🟢 Active';
  if (isOnCooldown) status = '🔴 Cooldown';
  else if (isRateLimited) status = `🟡 Rate Limited (${secondsUntilReset}s)`;

  stats.push({
    keyNumber: idx + 1,
    keyPreview: `${key.slice(0, 8)}...`,
    isCurrent: idx === currentKeyIdx,
    status: status,
    requestsThisMinute: rateLimit?.count || 0,
    totalRequests: keyStats.requests,
    successfulRequests: keyStats.successfulRequests,
    errors: keyStats.errors,
    lastUsed: keyStats.lastUsed ? new Date(keyStats.lastUsed).toISOString() : 'Never',
    lastError: tracking.lastError ? tracking.lastError.message : null
  });
});
return {
  totalKeys: apiKeys.length,
  currentKey: currentKeyIdx + 1,
  rateLimit: `${RATE_LIMIT_PER_MINUTE} req/min`,
  keys: stats
};
}

setInterval(() => {
const stats = getApiKeyStats();
console.log('--- API Key Status Report ---');
console.table(stats.keys.map(k => ({
  Index: k.keyNumber,
  Status: k.status,
  'This Min': k.requestsThisMinute,
  Ok: k.successfulRequests,
  Err: k.errors,
  Current: k.isCurrent ? '⭐' : ''
})));
}, 15 * 60 * 1000); 

export const token = process.env.DISCORD_BOT_TOKEN;

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

// State variables
let chatHistories = {};
let activeUsersInChannels = {};
let customInstructions = {};
let serverSettings = {};
let userSettings = {};
let userResponsePreference = {};
let alwaysRespondChannels = {};
let channelWideChatHistory = {};
let blacklistedUsers = {};
let continuousReplyChannels = {};
let imageUsage = {};
let birthdays = {};
let reminders = {};
let dailyQuotes = {};
let roulette = {};
let complimentCounts = {};
let complimentOptOut = {};
let userTimezones = {};
let serverDigests = {};
let quoteUsage = {};
let starterUsage = {};
let complimentUsage = {};
let userDigests = {};
let realive = {};
let summaryUsage = {};

export const state = {
get chatHistories() { return chatHistories; },
set chatHistories(v) { chatHistories = v; },
get activeUsersInChannels() { return activeUsersInChannels; },
set activeUsersInChannels(v) { activeUsersInChannels = v; },
get customInstructions() { return customInstructions; },
set customInstructions(v) { customInstructions = v; },
get serverSettings() { return serverSettings; },
set serverSettings(v) { serverSettings = v; },
get userSettings() { return userSettings; },
set userSettings(v) { userSettings = v; },
get userResponsePreference() { return userResponsePreference; },
set userResponsePreference(v) { userResponsePreference = v; },
get alwaysRespondChannels() { return alwaysRespondChannels; },
set alwaysRespondChannels(v) { alwaysRespondChannels = v; },
get channelWideChatHistory() { return channelWideChatHistory; },
set channelWideChatHistory(v) { channelWideChatHistory = v; },
get blacklistedUsers() { return blacklistedUsers; },
set blacklistedUsers(v) { blacklistedUsers = v; },
get continuousReplyChannels() { return continuousReplyChannels; },
set continuousReplyChannels(v) { continuousReplyChannels = v; },
get requestQueues() { return requestQueues; },
get imageUsage() { return imageUsage; },
set imageUsage(v) { imageUsage = v; },
get birthdays() { return birthdays; },
set birthdays(v) { birthdays = v; },
get reminders() { return reminders; },
set reminders(v) { reminders = v; },
get dailyQuotes() { return dailyQuotes; },
set dailyQuotes(v) { dailyQuotes = v; },
get roulette() { return roulette; },
set roulette(v) { roulette = v; },
get complimentCounts() { return complimentCounts; },
set complimentCounts(v) { complimentCounts = v; },
get complimentOptOut() { return complimentOptOut; },
set complimentOptOut(v) { complimentOptOut = v; },
get userTimezones() { return userTimezones; },
set userTimezones(v) { userTimezones = v; },
get serverDigests() { return serverDigests; },
set serverDigests(v) { serverDigests = v; },
get quoteUsage() { return quoteUsage; },
set quoteUsage(v) { quoteUsage = v; },
get starterUsage() { return starterUsage; },
set starterUsage(v) { starterUsage = v; },
get complimentUsage() { return complimentUsage; },
set complimentUsage(v) { complimentUsage = v; },
get userDigests() { return userDigests; },
set userDigests(v) { userDigests = v; },
get realive() { return realive; },
set realive(v) { realive = v; },
get summaryUsage() { return summaryUsage; },
set summaryUsage(v) { summaryUsage = v; }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const TEMP_DIR = path.join(__dirname, 'temp');

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

  for (const [userId, settings] of Object.entries(userSettings)) {
    savePromises.push(db.saveUserSettings(userId, settings));
  }

  for (const [guildId, settings] of Object.entries(serverSettings)) {
    savePromises.push(db.saveServerSettings(guildId, settings));
  }

  for (const [id, history] of Object.entries(chatHistories)) {
    savePromises.push(db.saveChatHistory(id, history));
  }

  for (const [id, instructions] of Object.entries(customInstructions)) {
    savePromises.push(db.saveCustomInstructions(id, instructions));
  }

  for (const [guildId, users] of Object.entries(blacklistedUsers)) {
    savePromises.push(db.saveBlacklistedUsers(guildId, users));
  }

  for (const [channelId, value] of Object.entries(alwaysRespondChannels)) {
    savePromises.push(db.saveChannelSetting(channelId, 'alwaysRespond', value));
  }
  for (const [channelId, value] of Object.entries(channelWideChatHistory)) {
    savePromises.push(db.saveChannelSetting(channelId, 'wideChatHistory', value));
  }
  for (const [channelId, value] of Object.entries(continuousReplyChannels)) {
    savePromises.push(db.saveChannelSetting(channelId, 'continuousReply', value));
  }

  for (const [userId, preference] of Object.entries(userResponsePreference)) {
    savePromises.push(db.saveUserResponsePreference(userId, preference));
  }

  for (const [userId, usage] of Object.entries(imageUsage)) {
    savePromises.push(db.saveImageUsage(userId, usage));
  }

  for (const [userId, data] of Object.entries(birthdays)) {
    savePromises.push(db.saveBirthday(userId, data));
  }

  for (const [channelId, config] of Object.entries(roulette)) {
    savePromises.push(db.saveRouletteConfig(channelId, config));
  }

  for (const [userId, config] of Object.entries(dailyQuotes)) {
    savePromises.push(db.saveDailyQuote(userId, config));
  }

  for (const [userId, count] of Object.entries(complimentCounts)) {
    savePromises.push(db.saveComplimentCount(userId, count));
  }

  for (const [userId, timezone] of Object.entries(userTimezones)) {
    savePromises.push(db.saveUserTimezone(userId, timezone));
  }

  for (const [guildId, digest] of Object.entries(serverDigests)) {
    savePromises.push(db.saveServerDigest(guildId, digest));
  }

  for (const [userId, usage] of Object.entries(quoteUsage)) {
    savePromises.push(db.saveQuoteUsage(userId, usage));
  }

  for (const [guildId, config] of Object.entries(realive)) {
    savePromises.push(db.saveRealiveConfig(guildId, config));
  }
  
  for (const [userId, usage] of Object.entries(summaryUsage)) {
    savePromises.push(db.saveSummaryUsage(userId, usage));
  }

  savePromises.push(db.saveActiveUsersInChannels(activeUsersInChannels));

  await Promise.all(savePromises);
} catch (error) {
  console.error('Error saving state to MongoDB:', error);
} finally {
  isSaving = false;
  if (savePending) {
    savePending = false;
    saveStateToFile();
  }
}
}

async function loadStateFromDB() {
try {
  await fs.mkdir(TEMP_DIR, {
    recursive: true
  });

  [
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

  alwaysRespondChannels = await db.getAllChannelSettings('alwaysRespond');
  channelWideChatHistory = await db.getAllChannelSettings('wideChatHistory');
  continuousReplyChannels = await db.getAllChannelSettings('continuousReply');

} catch (error) {
  console.error('Error loading state from MongoDB:', error);
}
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
  console.error('An error occurred while preserving attachment context:', error);
}
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

function scheduleDailyReset() {
try {
  const now = new Date();
  const nextReset = new Date();
  nextReset.setHours(0, 0, 0, 0);
  if (nextReset <= now) {
    nextReset.setDate(now.getDate() + 1);
  }
  const timeUntilNextReset = nextReset - now;

  setTimeout(async () => {
    await chatHistoryLock.runExclusive(async () => {
      preserveAttachmentContext(chatHistories);

      const currentMs = Date.now();
      
      for (const userId in imageUsage) {
        imageUsage[userId].count = 0;
        imageUsage[userId].lastReset = currentMs;
      }

      for (const userId in summaryUsage) {
        summaryUsage[userId].count = 0;
        summaryUsage[userId].lastReset = currentMs;
      }

      await saveStateToFile();
    });
    scheduleDailyReset();
  }, timeUntilNextReset);

} catch (error) {
  console.error('An error occurred while scheduling the daily reset:', error);
}
}

export async function initialize() {
try {
  await db.connectDB();
  await loadStateFromDB();
  scheduleDailyReset();
  console.log('--- Startup Stats ---');
  console.log(JSON.stringify(getApiKeyStats(), null, 2));
} catch (error) {
  console.error('Error during initialization:', error);
  throw error;
}
}

export function getHistory(id, guildId = null) {
const historyObject = chatHistories[id] || {};
let combinedHistory = [];

if (guildId && chatHistories[guildId]) {
  const guildHistory = chatHistories[guildId] || {};
  for (const messagesId in guildHistory) {
    if (guildHistory.hasOwnProperty(messagesId)) {
      combinedHistory = [...combinedHistory, ...guildHistory[messagesId]];
    }
  }
}

for (const messagesId in historyObject) {
  if (historyObject.hasOwnProperty(messagesId)) {
    combinedHistory = [...combinedHistory, ...historyObject[messagesId]];
  }
}

combinedHistory.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

const maxMessages = 50;
if (combinedHistory.length > maxMessages) {
  combinedHistory = combinedHistory.slice(-maxMessages);
}

const apiHistory = [];
let previousTimestamp = null;
const timeThresholdMs = 30 * 60 * 1000;

for (const entry of combinedHistory) {
  const apiEntry = {
    role: entry.role === 'assistant' ? 'model' : entry.role,
    parts: []
  };

  if (previousTimestamp) {
    const timeDiffMs = entry.timestamp - previousTimestamp;
    if (timeDiffMs > timeThresholdMs) {
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
        apiEntry.parts.push({
          text: textVal
        });
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
if (!chatHistories[id]) {
  chatHistories[id] = {};
}

if (!chatHistories[id][messagesId]) {
  chatHistories[id][messagesId] = [];
}

const historyWithUserInfo = newHistory.map(entry => {
  if (entry.role === 'user' && (username || displayName)) {
    return {
      ...entry,
      userId: messagesId,
      username: username,
      displayName: displayName,
      timestamp: Date.now()
    };
  }
  return {
    ...entry,
    timestamp: entry.timestamp || Date.now()
  };
});

chatHistories[id][messagesId] = [...chatHistories[id][messagesId], ...historyWithUserInfo];
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
  } else if (!state.serverSettings[guildId].allowedChannels) {
    state.serverSettings[guildId].allowedChannels = [];
  }

  if (state.serverSettings[guildId].showActionButtons === undefined) {
    state.serverSettings[guildId].showActionButtons = false;
  }
  if (state.serverSettings[guildId].continuousReply === undefined) {
    state.serverSettings[guildId].continuousReply = true;
  }
} catch (error) {
  console.error('Error initializing blacklist for guild:', error);
}
}

export function checkImageRateLimit(userId) {
const now = Date.now();
const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_MINUTE = 60 * 1000;

if (!imageUsage[userId]) {
  imageUsage[userId] = {
    count: 0,
    lastReset: now,
    lastRequest: 0
  };
}

const usage = imageUsage[userId];

if (now - usage.lastReset > ONE_DAY) {
  usage.count = 0;
  usage.lastReset = now;
}

if (now - usage.lastRequest < ONE_MINUTE) {
  const waitSeconds = Math.ceil((ONE_MINUTE - (now - usage.lastRequest)) / 1000);
  return {
    allowed: false,
    message: `⏳ Please wait ${waitSeconds}s before generating another image.`
  };
}

const limit = config.imageConfig?.maxPerDay || 10;
if (usage.count >= limit) {
  return {
    allowed: false,
    message: `🛑 You've reached your daily limit of ${limit} images. Limits reset daily.`
  };
}

return {
  allowed: true
};
}

export function incrementImageUsage(userId) {
const now = Date.now();
if (!imageUsage[userId]) {
  imageUsage[userId] = {
    count: 0,
    lastReset: now,
    lastRequest: 0
  };
}

const ONE_DAY = 24 * 60 * 60 * 1000;
if (now - imageUsage[userId].lastReset > ONE_DAY) {
  imageUsage[userId].count = 0;
  imageUsage[userId].lastReset = now;
}

imageUsage[userId].count++;
imageUsage[userId].lastRequest = now;
}

export function checkSummaryRateLimit(userId) {
const now = Date.now();
const ONE_DAY = 24 * 60 * 60 * 1000;
const LIMIT = 10;

if (!summaryUsage[userId]) {
  summaryUsage[userId] = {
    count: 0,
    lastReset: now
  };
}

const usage = summaryUsage[userId];

if (now - usage.lastReset > ONE_DAY) {
  usage.count = 0;
  usage.lastReset = now;
}

if (usage.count >= LIMIT) {
  return {
    allowed: false,
    message: `🛑 You've reached your daily limit of ${LIMIT} summaries. Limits reset daily.`
  };
}

return {
  allowed: true
};
}

export function incrementSummaryUsage(userId) {
const now = Date.now();
if (!summaryUsage[userId]) {
  summaryUsage[userId] = {
    count: 0,
    lastReset: now
  };
}

const usage = summaryUsage[userId];

const ONE_DAY = 24 * 60 * 60 * 1000;
if (now - usage.lastReset > ONE_DAY) {
  usage.count = 0;
  usage.lastReset = now;
}

usage.count++;
}

process.on('SIGINT', async () => {
await saveStateToFile();
await db.closeDB();
console.log('--- Shutdown Stats ---');
console.log(JSON.stringify(getApiKeyStats(), null, 2));
process.exit(0);
});

process.on('SIGTERM', async () => {
await saveStateToFile();
await db.closeDB();
console.log('--- Shutdown Stats ---');
console.log(JSON.stringify(getApiKeyStats(), null, 2));
process.exit(0);
});
