/**
 * @fileoverview MongoDB connection management, lazy collection cache, and
 *               shared constants used by all repository modules.
 * @module database/connection
 */

import { MongoClient } from 'mongodb';
import { Logger }      from '../core/Logger.js';

const logger = Logger.get('Database');

// ============================================================================
// CONFIGURATION
// ============================================================================

/** MongoDB driver connection pool settings. */
export const CONNECTION_CONFIG = Object.freeze({
  MAX_POOL_SIZE:                3,   // Render free tier: keep low
  MIN_POOL_SIZE:                1,
  SERVER_SELECTION_TIMEOUT_MS:  5_000,
  SOCKET_TIMEOUT_MS:            30_000,
  MAX_IDLE_TIME_MS:             60_000,  // Aggressively close idle sockets
  RETRY_WRITES:                 true,
  W:                            'majority'
});

/** Retry config for initial connection attempts. */
export const RETRY_CONFIG = Object.freeze({
  MAX_ATTEMPTS:   3,
  BASE_DELAY_MS:  1_000,
  MAX_DELAY_MS:   5_000
});

/** Atlas Vector Search settings. */
export const VECTOR_SEARCH_CONFIG = Object.freeze({
  INDEX_NAME:                'vector_index',
  PATH:                      'embedding',
  NUM_CANDIDATES_MULTIPLIER: 10,  // Was 20 — halved for sub-3s on Render free tier
  DEFAULT_LIMIT:             4,   // Was 5 — 4 results plenty, saves one doc parse
  SCORE_THRESHOLD:           0.72 // Skip results below this similarity score
});

/** Canonical collection name registry.
 *  BUG FIX: added QUOTE_USAGE — saveQuoteUsage/getQuoteUsage previously used
 *  a raw 'quoteUsage' string literal instead of this constant.
 */
export const COLLECTIONS = Object.freeze({
  USER_SETTINGS:        'userSettings',
  SERVER_SETTINGS:      'serverSettings',
  CHAT_HISTORIES:       'chatHistories',
  CUSTOM_INSTRUCTIONS:  'customInstructions',
  BLACKLISTED_USERS:    'blacklistedUsers',
  CHANNEL_SETTINGS:     'channelSettings',
  MEMORY_ENTRIES:       'memoryEntries',
  IMAGE_USAGE:          'imageUsage',
  BIRTHDAYS:            'birthdays',
  REMINDERS:            'reminders',
  DAILY_QUOTES:         'dailyQuotes',
  ROULETTE:             'roulette',
  COMPLIMENTS:          'compliments',
  COMPLIMENT_OPT_OUT:   'complimentOptOut',
  USER_TIMEZONES:       'userTimezones',
  SERVER_DIGESTS:       'serverDigests',
  ACTIVE_USERS:         'activeUsersInChannels',
  USER_RESPONSE_PREF:   'userResponsePreference',
  REALIVE:              'realive',
  SUMMARY_USAGE:        'summaryUsage',
  QUOTE_USAGE:          'quoteUsage',  // BUG FIX: was missing
  USER_FACTS:           'userFacts',
  WEEKLY_SUMMARIES:     'weeklySummaries',
  DAILY_MSG_USAGE:      'dailyMsgUsage'
});

// ============================================================================
// MODULE STATE
// ============================================================================

/** @type {MongoClient|null} */
let client = null;

/** @type {import('mongodb').Db|null} */
let db = null;

/** Lazy-loaded collection handle cache. Invalidated on close. */
const collectionCache = new Map();

/**
 * Tracks whether background index creation has been scheduled for the current
 * connection. Reset in closeDB so a reconnect will re-schedule it.
 * BUG FIX: original never reset this flag, so after a disconnect+reconnect
 * indexes were never re-registered.
 */
export let indexesCreated = false;
export function setIndexesCreated(v) { indexesCreated = v; }

// ============================================================================
// CONNECTION MANAGEMENT
// ============================================================================

/**
 * Connect to MongoDB. Returns the existing connection if healthy.
 * BUG FIX: original returned the stale `db` reference without checking whether
 * the underlying connection was still alive after a network drop. Now runs a
 * lightweight ping before returning the cached handle.
 *
 * @returns {Promise<import('mongodb').Db>}
 * @throws {Error} If all retry attempts fail
 */
export async function connectDB() {
  // Return cached connection only if it is still alive
  if (db) {
    try {
      await client.db().admin().ping();
      return db;
    } catch {
      logger.warn('Cached DB connection appears stale — reconnecting…');
      client = null;
      db     = null;
      collectionCache.clear();
      indexesCreated = false;
    }
  }

  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/gemini-discord-bot';
  let lastError;

  for (let attempt = 1; attempt <= RETRY_CONFIG.MAX_ATTEMPTS; attempt++) {
    try {
      logger.info(`Attempting MongoDB connection (${attempt}/${RETRY_CONFIG.MAX_ATTEMPTS})…`);

      client = new MongoClient(uri, {
        maxPoolSize:              CONNECTION_CONFIG.MAX_POOL_SIZE,
        minPoolSize:              CONNECTION_CONFIG.MIN_POOL_SIZE,
        serverSelectionTimeoutMS: CONNECTION_CONFIG.SERVER_SELECTION_TIMEOUT_MS,
        socketTimeoutMS:          CONNECTION_CONFIG.SOCKET_TIMEOUT_MS,
        maxIdleTimeMS:            CONNECTION_CONFIG.MAX_IDLE_TIME_MS,
        retryWrites:              CONNECTION_CONFIG.RETRY_WRITES,
        w:                        CONNECTION_CONFIG.W
      });

      await client.connect();
      await client.db().admin().ping();

      db = client.db();
      logger.info('Connected to MongoDB successfully');

      // Import lazily to avoid circular dependency at module load time
      const { createIndexes } = await import('./indexManager.js');
      createIndexes().catch(err =>
        logger.warn(`Background index creation failed: ${err.message}`)
      );

      return db;

    } catch (error) {
      lastError = error;
      logger.error(`Connection attempt ${attempt} failed: ${error.message}`);

      if (attempt < RETRY_CONFIG.MAX_ATTEMPTS) {
        const delay = Math.min(
          RETRY_CONFIG.BASE_DELAY_MS * Math.pow(2, attempt - 1),
          RETRY_CONFIG.MAX_DELAY_MS
        );
        logger.info(`Retrying in ${delay}ms…`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`MongoDB connection failed after ${RETRY_CONFIG.MAX_ATTEMPTS} attempts: ${lastError.message}`);
}

/**
 * Close the MongoDB connection and reset all module state.
 * @returns {Promise<void>}
 */
export async function closeDB() {
  if (!client) {
    logger.info('No active database connection to close');
    return;
  }

  try {
    await client.close();
    client         = null;
    db             = null;
    indexesCreated = false;  // BUG FIX: allow re-registration on reconnect
    collectionCache.clear();
    logger.info('MongoDB connection closed');
  } catch (error) {
    logger.error('Error closing MongoDB connection', error);
    throw error;
  }
}

/**
 * Returns the raw Db instance. Throws if not connected.
 * @returns {import('mongodb').Db}
 */
export function getDB() {
  if (!db) throw new Error('Database not connected. Call connectDB() first.');
  return db;
}

// ============================================================================
// LAZY COLLECTION ACCESSOR
// ============================================================================

/**
 * Returns a cached Collection handle, creating it on first access.
 * @param {string} collectionName
 * @returns {import('mongodb').Collection}
 */
export function getCollection(collectionName) {
  if (!db) throw new Error('Database not connected');
  if (!collectionCache.has(collectionName)) {
    collectionCache.set(collectionName, db.collection(collectionName));
  }
  return collectionCache.get(collectionName);
}
