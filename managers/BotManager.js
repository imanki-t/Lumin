/**
 * @fileoverview Bot Manager — thin orchestrator that wires together all sub-managers
 * and provides the `genAI` proxy, Discord `client`, `TEMP_DIR`, and `initialize()`.
 *
 * This file intentionally stays thin (< 200 lines of logic).  All heavy lifting
 * lives in the specialist managers it imports.
 *
 * What lives here:
 *  - Discord `client` creation
 *  - `TEMP_DIR` constant
 *  - `genAI` Proxy — wraps every Gemini call through `withRetryPerModel`
 *  - `createPartFromUri()` — convenience helper
 *  - `initialize()` — startup sequence (DB → state → schedule → log)
 *  - `gracefulShutdown()` — SIGINT / SIGTERM handler
 *  - Re-export barrel — everything other modules import from `botManager.js`
 *    still works without any import changes
 *
 * @module managers/BotManager
 */

import dotenv from 'dotenv';
dotenv.config();

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import path from 'path';
import { fileURLToPath } from 'url';

import * as db from '../database.js';
import { Logger } from '../core/Logger.js';
import { memorySystem } from '../memory/MemorySystem.js';

import {
  withRetryPerModel,
  withRetry,
  getCurrentClient,
  getApiKeyStats,
  getApiKeyCount,
  switchToNextKey,
  switchToNextKeyOrModel
} from './ApiKeyManager.js';

import {
  chatHistoryLock,
  requestQueues,
  checkImageRateLimit,
  incrementImageUsage,
  checkSummaryRateLimit,
  incrementSummaryUsage,
  getDailyMessageStats
} from './QueueManager.js';

import {
  state,
  saveStateToFile,
  loadStateFromDB,
  getHistory,
  updateChatHistory,
  getUserResponsePreference,
  initializeBlacklistForGuild,
  scheduleDailyReset,
  runMigrations,
  BOT_CONFIG,
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_USER_SETTINGS,
  POLL_CONFIG,
  MIGRATION_CONFIG
} from './StateManager.js';

const logger = Logger.get('BotManager');

// ============================================================================
// FILE SYSTEM
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/**
 * Temporary directory for all file operations (uploads, conversions, responses).
 * Resolved relative to the project root (one level above `managers/`).
 * @type {string}
 */
export const TEMP_DIR = process.env.TEMP_DIR
  ? path.resolve(process.env.TEMP_DIR)
  : path.join(__dirname, '..', 'temp');

// ============================================================================
// DISCORD CLIENT
// ============================================================================

/** Discord bot token. @type {string|undefined} */
export const token = process.env.DISCORD_BOT_TOKEN;

/**
 * Discord.js client with the minimal intents Lumin needs.
 * @type {import('discord.js').Client}
 */
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// ============================================================================
// GEMINI AI PROXY
// ============================================================================

/**
 * Proxied Gemini AI client.
 *
 * Every call to `genAI.models.generateContent(…)` etc. is automatically routed
 * through `withRetryPerModel` in ApiKeyManager, which handles:
 *  - Per-model, per-key rate-limit tracking
 *  - Intelligent model fallback (same key, different model)
 *  - Key rotation when all models on the current key are exhausted
 *  - Exponential back-off with jitter
 *
 * Consumers should use this exactly like the raw `GoogleGenAI` client.
 *
 * @type {Proxy}
 */
export const genAI = new Proxy({}, {
  get(_target, prop) {
    // ── models ───────────────────────────────────────────────────────────────
    if (prop === 'models') {
      return {
        generateContent: (request) =>
          withRetryPerModel(
            (modelName) => {
              request.model = modelName;
              return getCurrentClient().models.generateContent(request);
            },
            request.model
          ),

        generateContentStream: (request) =>
          withRetryPerModel(
            (modelName) => {
              request.model = modelName;
              return getCurrentClient().models.generateContentStream(request);
            },
            request.model
          ),

        // embedContent doesn't need per-model rotation — just basic retry.
        embedContent: (request) =>
          withRetry(() => getCurrentClient().models.embedContent(request))
      };
    }

    // ── chats ─────────────────────────────────────────────────────────────────
    if (prop === 'chats') {
      return {
        create: (chatConfig) => {
          const chat = getCurrentClient().chats.create(chatConfig);
          return {
            sendMessage: (message) => withRetry(() => chat.sendMessage(message))
          };
        }
      };
    }

    // ── files ─────────────────────────────────────────────────────────────────
    if (prop === 'files') {
      return {
        upload: (options) => withRetry(() => getCurrentClient().files.upload(options)),
        get:    (options) => withRetry(() => getCurrentClient().files.get(options))
      };
    }

    // Fall through for any other property.
    const value = getCurrentClient()[prop];
    return typeof value === 'function' ? value.bind(getCurrentClient()) : value;
  }
});

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build a Gemini file-data part from an uploaded file URI.
 *
 * @param {string} fileUri  - URI returned by `genAI.files.upload()`.
 * @param {string} mimeType - MIME type of the file.
 * @returns {{ fileData: { fileUri: string, mimeType: string } }}
 */
export function createPartFromUri(fileUri, mimeType) {
  return { fileData: { fileUri, mimeType } };
}

// ============================================================================
// RESOURCE CONFIGURATION (intervals — kept here with initialize())
// ============================================================================

const RESOURCE_CONFIG = Object.freeze({
  /** How often to auto-save state (ms). */
  STATE_SAVE_INTERVAL:  300_000,  // 5 minutes
  /** How often to log API key statistics (ms). */
  STATS_LOG_INTERVAL:   900_000   // 15 minutes
});

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize Bot Manager.
 *
 * Sequence:
 *  1. Validate environment
 *  2. Connect to database
 *  3. Load state from DB
 *  4. Trigger migrations (background, non-blocking)
 *  5. Schedule daily reset
 *  6. Schedule periodic state saves
 *  7. Schedule API key statistics logging
 *  8. Log startup summary
 *
 * @returns {Promise<void>}
 * @throws {Error} On critical failures (missing token, DB connection error, etc.)
 */
export async function initialize() {
  logger.info('Initializing Bot Manager…');

  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN not found in environment variables');
  }

  // 1. Database
  await db.connectDB();
  logger.info('Database connected');

  // 2. State
  await loadStateFromDB(TEMP_DIR);
  logger.info('State loaded');

  // 3. Redis cache (optional — no-ops if REDIS_URL not set)
  await memorySystem.init();
  logger.info('Memory system initialized');

  // 3. Migrations (background — never block startup)
  if (MIGRATION_CONFIG.ENABLE_MIGRATION) {
    runMigrations().catch(err =>
      logger.warn(`Migration failed (non-critical): ${err.message}`)
    );
  }

  // 4. Daily reset
  scheduleDailyReset();
  logger.info('Daily reset scheduled');

  // 5. Periodic state save
  setInterval(async () => {
    try {
      await saveStateToFile();
      logger.info('Periodic state save completed');
    } catch (error) {
      logger.error('Periodic state save failed', error);
    }
  }, RESOURCE_CONFIG.STATE_SAVE_INTERVAL);

  // 6. Periodic API key statistics
  setInterval(() => {
    const stats = getApiKeyStats();
    logger.info('API Key Statistics Report');
    console.table(
      stats.keys.map(k => ({
        Key:      k.keyNumber,
        Status:   k.status,
        Requests: k.totalRequests,
        Success:  k.successfulRequests,
        Errors:   k.errors,
        Current:  k.isCurrent ? '⭐' : ''
      }))
    );
  }, RESOURCE_CONFIG.STATS_LOG_INTERVAL);

  // 7. Compact startup log
  const startupStats = getApiKeyStats();
  logger.info(
    `Startup: ${startupStats.totalKeys} keys | Current: Key ${startupStats.currentKey} | ` +
    startupStats.keys
      .map(k => `Key${k.keyNumber}[${k.status} req:${k.totalRequests} err:${k.errors}${k.isCurrent ? ' *' : ''}]`)
      .join(' ')
  );

  logger.info('Bot Manager initialized successfully ✅');
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

/**
 * Perform graceful shutdown: save state, close DB, log final stats, exit.
 * @param {string} signal - Signal name (e.g. 'SIGINT', 'SIGTERM').
 */
async function gracefulShutdown(signal) {
  logger.info(`Received ${signal} — performing graceful shutdown…`);

  try {
    logger.info('Saving final state…');
    await saveStateToFile();
    logger.info('State saved');

    logger.info('Closing database connection…');
    await db.closeDB();
    logger.info('Database connection closed');

    logger.info('Closing Redis connection…');
    const { redisCache } = await import('../memory/RedisCache.js');
    await redisCache.disconnect();
    logger.info('Redis disconnected');

    const shutdownStats = getApiKeyStats();
    logger.info(
      `Shutdown stats: ${shutdownStats.totalKeys} keys | ` +
      shutdownStats.keys
        .map(k => `Key${k.keyNumber}[req:${k.totalRequests} ok:${k.successfulRequests} err:${k.errors}]`)
        .join(' ')
    );

    logger.info('Graceful shutdown completed ✅');
    process.exit(0);

  } catch (error) {
    logger.error('Error during graceful shutdown', error);
    process.exit(1);
  }
}

// NOTE: SIGINT/SIGTERM are intentionally NOT registered here.
// They are registered in index.js, which also destroys the Discord client.
// Registering in both places caused a double-shutdown race in the original code.

// ============================================================================
// RE-EXPORT BARREL
// ============================================================================
// Everything that other modules currently import from `botManager.js` is
// re-exported here so zero import paths need to change.

export {
  // ApiKeyManager
  getApiKeyStats,
  switchToNextKey,
  switchToNextKeyOrModel,

  // QueueManager
  chatHistoryLock,
  requestQueues,
  checkImageRateLimit,
  incrementImageUsage,
  checkSummaryRateLimit,
  incrementSummaryUsage,
  getDailyMessageStats,

  // StateManager
  state,
  saveStateToFile,
  getHistory,
  updateChatHistory,
  getUserResponsePreference,
  initializeBlacklistForGuild,
  BOT_CONFIG,
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_USER_SETTINGS,
  POLL_CONFIG,
  MIGRATION_CONFIG
};

// Default export mirrors the original botManager.js shape.
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
  TEMP_DIR,
  BOT_CONFIG,
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_USER_SETTINGS,
  POLL_CONFIG,
  MIGRATION_CONFIG
};
