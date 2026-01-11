/**
 * @fileoverview MongoDB Database Layer - High-performance data persistence with lazy loading
 * @version 3.0.0
 * @module database
 * 
 * Features:
 * - Lazy collection loading for optimal startup time
 * - Parallel batch operations for maximum throughput
 * - Comprehensive error handling with graceful degradation
 * - Automatic index creation and maintenance
 * - Vector search support for RAG memory system
 * - Connection pooling and retry logic
 * 
 * @requires mongodb ^6.11.0
 */

import { MongoClient } from 'mongodb';

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/** MongoDB connection configuration */
const CONNECTION_CONFIG = {
  MAX_POOL_SIZE: 10,
  MIN_POOL_SIZE: 2,
  SERVER_SELECTION_TIMEOUT_MS: 5000,
  SOCKET_TIMEOUT_MS: 45000,
  MAX_IDLE_TIME_MS: 300000,
  RETRY_WRITES: true,
  W: 'majority'
};

/** Collection names registry */
const COLLECTIONS = Object.freeze({
  USER_SETTINGS: 'userSettings',
  SERVER_SETTINGS: 'serverSettings',
  CHAT_HISTORIES: 'chatHistories',
  CUSTOM_INSTRUCTIONS: 'customInstructions',
  BLACKLISTED_USERS: 'blacklistedUsers',
  CHANNEL_SETTINGS: 'channelSettings',
  MEMORY_ENTRIES: 'memoryEntries',
  IMAGE_USAGE: 'imageUsage',
  BIRTHDAYS: 'birthdays',
  REMINDERS: 'reminders',
  DAILY_QUOTES: 'dailyQuotes',
  ROULETTE: 'roulette',
  COMPLIMENTS: 'compliments',
  COMPLIMENT_OPT_OUT: 'complimentOptOut',
  USER_TIMEZONES: 'userTimezones',
  SERVER_DIGESTS: 'serverDigests',
  ACTIVE_USERS: 'activeUsersInChannels',
  USER_RESPONSE_PREF: 'userResponsePreference',
  REALIVE: 'realive',
  SUMMARY_USAGE: 'summaryUsage',
  USER_FACTS: 'userFacts'
});

/** Vector search configuration */
const VECTOR_SEARCH_CONFIG = {
  INDEX_NAME: 'vector_index',
  PATH: 'embedding',
  NUM_CANDIDATES_MULTIPLIER: 20,
  DEFAULT_LIMIT: 5
};

/** Operation retry configuration */
const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 1000,
  MAX_DELAY_MS: 5000
};

// ============================================================================
// MODULE STATE
// ============================================================================

let client = null;
let db = null;

/** Lazy-loaded collection cache */
const collectionCache = new Map();

/** Index creation status tracker */
let indexesCreated = false;

// ============================================================================
// CONNECTION MANAGEMENT
// ============================================================================

/**
 * Establish MongoDB connection with retry logic
 * @returns {Promise<Db>} Connected database instance
 * @throws {Error} If connection fails after all retries
 */
export async function connectDB() {
  if (db) {
    console.log('ℹ️ Database already connected');
    return db;
  }

  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/gemini-discord-bot';
  let lastError;

  for (let attempt = 1; attempt <= RETRY_CONFIG.MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`🔌 Attempting MongoDB connection (${attempt}/${RETRY_CONFIG.MAX_ATTEMPTS})...`);

      client = new MongoClient(uri, {
        maxPoolSize: CONNECTION_CONFIG.MAX_POOL_SIZE,
        minPoolSize: CONNECTION_CONFIG.MIN_POOL_SIZE,
        serverSelectionTimeoutMS: CONNECTION_CONFIG.SERVER_SELECTION_TIMEOUT_MS,
        socketTimeoutMS: CONNECTION_CONFIG.SOCKET_TIMEOUT_MS,
        maxIdleTimeMS: CONNECTION_CONFIG.MAX_IDLE_TIME_MS,
        retryWrites: CONNECTION_CONFIG.RETRY_WRITES,
        w: CONNECTION_CONFIG.W
      });

      await client.connect();
      await client.db().admin().ping();

      db = client.db();
      console.log('✅ Connected to MongoDB successfully');

      // Create indexes in background (non-blocking)
      createIndexes().catch(err => 
        console.error('⚠️ Background index creation failed:', err.message)
      );

      return db;

    } catch (error) {
      lastError = error;
      console.error(`❌ Connection attempt ${attempt} failed:`, error.message);

      if (attempt < RETRY_CONFIG.MAX_ATTEMPTS) {
        const delay = Math.min(
          RETRY_CONFIG.BASE_DELAY_MS * Math.pow(2, attempt - 1),
          RETRY_CONFIG.MAX_DELAY_MS
        );
        console.log(`⏳ Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`MongoDB connection failed after ${RETRY_CONFIG.MAX_ATTEMPTS} attempts: ${lastError.message}`);
}

/**
 * Close MongoDB connection gracefully
 * @returns {Promise<void>}
 */
export async function closeDB() {
  if (!client) {
    console.log('ℹ️ No active database connection to close');
    return;
  }

  try {
    await client.close();
    client = null;
    db = null;
    collectionCache.clear();
    indexesCreated = false;
    console.log('✅ MongoDB connection closed');
  } catch (error) {
    console.error('❌ Error closing MongoDB connection:', error.message);
    throw error;
  }
}

/**
 * Get database instance
 * @returns {Db} Database instance
 * @throws {Error} If database is not connected
 */
export function getDB() {
  if (!db) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return db;
}

// ============================================================================
// LAZY COLLECTION LOADING
// ============================================================================

/**
 * Get collection with lazy loading and caching
 * @param {string} collectionName - Name of the collection
 * @returns {Collection} MongoDB collection
 */
function getCollection(collectionName) {
  if (!db) {
    throw new Error('Database not connected');
  }

  if (!collectionCache.has(collectionName)) {
    collectionCache.set(collectionName, db.collection(collectionName));
  }

  return collectionCache.get(collectionName);
}

// ============================================================================
// INDEX CREATION
// ============================================================================

/**
 * Create all required indexes for optimal query performance
 * Runs in background to avoid blocking startup
 * @returns {Promise<void>}
 */
async function createIndexes() {
  if (indexesCreated || !db) return;

  try {
    console.log('🔨 Creating database indexes...');

    // Define all indexes in parallel-friendly structure
    const indexOperations = [
      // Core collections
      { collection: COLLECTIONS.USER_SETTINGS, index: { userId: 1 }, options: { unique: true } },
      { collection: COLLECTIONS.SERVER_SETTINGS, index: { guildId: 1 }, options: { unique: true } },
      { collection: COLLECTIONS.CHAT_HISTORIES, index: { id: 1 }, options: { unique: true } },
      { collection: COLLECTIONS.CUSTOM_INSTRUCTIONS, index: { id: 1 }, options: { unique: true } },
      { collection: COLLECTIONS.BLACKLISTED_USERS, index: { guildId: 1 }, options: { unique: true } },
      { collection: COLLECTIONS.CHANNEL_SETTINGS, index: { channelId: 1 }, options: { unique: true } },

      // Memory system - multiple indexes for RAG performance
      { collection: COLLECTIONS.MEMORY_ENTRIES, index: { 'metadata.historyId': 1, timestamp: -1 } },
      { collection: COLLECTIONS.MEMORY_ENTRIES, index: { 'metadata.userId': 1 } },
      { collection: COLLECTIONS.MEMORY_ENTRIES, index: { 'metadata.guildId': 1 } },

      // Feature collections
      { collection: COLLECTIONS.IMAGE_USAGE, index: { userId: 1 }, options: { unique: true } },
      { collection: COLLECTIONS.BIRTHDAYS, index: { userId: 1 }, options: { unique: true } },
      { collection: COLLECTIONS.REMINDERS, index: { userId: 1, id: 1 } },
      { collection: COLLECTIONS.DAILY_QUOTES, index: { userId: 1 }, options: { unique: true } },
      { collection: COLLECTIONS.ROULETTE, index: { channelId: 1 }, options: { unique: true } },
      { collection: COLLECTIONS.COMPLIMENTS, index: { userId: 1 }, options: { unique: true } },
      { collection: COLLECTIONS.USER_TIMEZONES, index: { userId: 1 }, options: { unique: true } },
      { collection: COLLECTIONS.SERVER_DIGESTS, index: { guildId: 1 }, options: { unique: true } },
      { collection: COLLECTIONS.REALIVE, index: { guildId: 1 }, options: { unique: true } },
      { collection: COLLECTIONS.SUMMARY_USAGE, index: { userId: 1 }, options: { unique: true } },

      // User facts with compound index for efficient retrieval
      { collection: COLLECTIONS.USER_FACTS, index: { userId: 1, createdAt: -1 } }
    ];

    // Create all indexes in parallel
    await Promise.all(
      indexOperations.map(async ({ collection, index, options = {} }) => {
        try {
          await getCollection(collection).createIndex(index, options);
        } catch (error) {
          // Ignore duplicate key errors (index already exists)
          if (error.code !== 85 && error.code !== 86) {
            console.error(`⚠️ Failed to create index on ${collection}:`, error.message);
          }
        }
      })
    );

    indexesCreated = true;
    console.log('✅ Database indexes created successfully');

  } catch (error) {
    console.error('❌ Critical error during index creation:', error.message);
  }
}

// ============================================================================
// VECTOR SEARCH IMPLEMENTATION
// ============================================================================

/**
 * Find similar memories using vector search
 * Requires Atlas Vector Search index named "vector_index" on "embedding" field
 * 
 * @param {string} historyId - History identifier
 * @param {number[]} queryEmbedding - Query vector
 * @param {number} [limit=5] - Maximum results to return
 * @returns {Promise<Array>} Similar memory entries with scores
 */
export async function findSimilarMemories(historyId, queryEmbedding, limit = VECTOR_SEARCH_CONFIG.DEFAULT_LIMIT) {
  try {
    const pipeline = [
      {
        $vectorSearch: {
          index: VECTOR_SEARCH_CONFIG.INDEX_NAME,
          path: VECTOR_SEARCH_CONFIG.PATH,
          queryVector: queryEmbedding,
          numCandidates: limit * VECTOR_SEARCH_CONFIG.NUM_CANDIDATES_MULTIPLIER,
          limit: limit,
          filter: { 'metadata.historyId': { $eq: historyId } }
        }
      },
      {
        $project: {
          _id: 0,
          messages: 1,
          timestamp: 1,
          text: 1,
          metadata: 1,
          score: { $meta: 'vectorSearchScore' }
        }
      }
    ];

    const results = await getCollection(COLLECTIONS.MEMORY_ENTRIES)
      .aggregate(pipeline)
      .toArray();

    return results;

  } catch (error) {
    // Graceful fallback for missing index or other errors
    if (error.codeName === 'IndexNotFound' || error.message?.includes('$vectorSearch')) {
      console.log('ℹ️ Vector search index not available, using fallback search');
      return null;
    }

    console.error('❌ Vector search error:', error.message);
    return null;
  }
}

/**
 * Find similar memories with additional metadata filters
 * 
 * @param {string} historyId - History identifier
 * @param {number[]} queryEmbedding - Query vector
 * @param {number} [limit=5] - Maximum results to return
 * @param {Object} [extraFilter={}] - Additional filter criteria
 * @param {string} [extraFilter.userId] - Filter by user ID
 * @param {string} [extraFilter.guildId] - Filter by guild ID
 * @returns {Promise<Array|null>} Similar memory entries or null on error
 */
export async function findSimilarMemoriesWithFilter(historyId, queryEmbedding, limit = VECTOR_SEARCH_CONFIG.DEFAULT_LIMIT, extraFilter = {}) {
  try {
    const filter = { 'metadata.historyId': { $eq: historyId } };

    if (extraFilter.userId) {
      filter['metadata.userId'] = { $eq: extraFilter.userId };
    }
    if (extraFilter.guildId) {
      filter['metadata.guildId'] = { $eq: extraFilter.guildId };
    }

    const pipeline = [
      {
        $vectorSearch: {
          index: VECTOR_SEARCH_CONFIG.INDEX_NAME,
          path: VECTOR_SEARCH_CONFIG.PATH,
          queryVector: queryEmbedding,
          numCandidates: limit * VECTOR_SEARCH_CONFIG.NUM_CANDIDATES_MULTIPLIER,
          limit: limit,
          filter: filter
        }
      },
      {
        $project: {
          _id: 0,
          messages: 1,
          timestamp: 1,
          text: 1,
          metadata: 1,
          score: { $meta: 'vectorSearchScore' }
        }
      }
    ];

    const results = await getCollection(COLLECTIONS.MEMORY_ENTRIES)
      .aggregate(pipeline)
      .toArray();

    return results;

  } catch (error) {
    if (error.codeName === 'IndexNotFound' || error.message?.includes('$vectorSearch')) {
      console.log('ℹ️ Vector search index not available for filtered search');
      return null;
    }

    console.error('❌ Filtered vector search error:', error.message);
    return null;
  }
}

// ============================================================================
// PERSONAL DATA HELPERS (FOR RAG CONTEXT)
// ============================================================================

/**
 * Get user birthday for personal context
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Birthday data or null
 */
export async function getBirthday(userId) {
  try {
    const doc = await getCollection(COLLECTIONS.BIRTHDAYS).findOne({ userId });
    if (!doc) return null;

    return {
      month: doc.month,
      day: doc.day,
      name: doc.name
    };
  } catch (error) {
    console.error('❌ Error getting birthday:', error.message);
    return null;
  }
}

/**
 * Get user's active reminders
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Active reminders
 */
export async function getUserReminders(userId) {
  try {
    const reminders = await getCollection(COLLECTIONS.REMINDERS)
      .find({ userId, active: true })
      .toArray();

    return reminders;
  } catch (error) {
    console.error('❌ Error getting user reminders:', error.message);
    return [];
  }
}

/**
 * Get user's compliment count
 * @param {string} userId - User ID
 * @returns {Promise<number>} Compliment count
 */
export async function getComplimentCount(userId) {
  try {
    const doc = await getCollection(COLLECTIONS.COMPLIMENTS).findOne({ userId });
    return doc?.count || 0;
  } catch (error) {
    console.error('❌ Error getting compliment count:', error.message);
    return 0;
  }
}

/**
 * Get user's daily quote configuration
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Quote config or null
 */
export async function getUserDailyQuote(userId) {
  try {
    const doc = await getCollection(COLLECTIONS.DAILY_QUOTES).findOne({ userId });
    if (!doc) return null;

    return {
      active: doc.active,
      category: doc.category,
      time: doc.time
    };
  } catch (error) {
    console.error('❌ Error getting daily quote:', error.message);
    return null;
  }
}

// ============================================================================
// USER SETTINGS
// ============================================================================

/**
 * Save user settings
 * @param {string} userId - User ID
 * @param {Object} settings - Settings object
 * @returns {Promise<void>}
 */
export async function saveUserSettings(userId, settings) {
  try {
    await getCollection(COLLECTIONS.USER_SETTINGS).updateOne(
      { userId },
      { $set: { userId, ...settings, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving user settings:', error.message);
    throw error;
  }
}

/**
 * Get user settings
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Settings or null
 */
export async function getUserSettings(userId) {
  try {
    const settings = await getCollection(COLLECTIONS.USER_SETTINGS).findOne({ userId });
    return settings || null;
  } catch (error) {
    console.error('❌ Error getting user settings:', error.message);
    return null;
  }
}

/**
 * Get all user settings (for bot initialization)
 * @returns {Promise<Object>} Map of userId to settings
 */
export async function getAllUserSettings() {
  try {
    const settings = await getCollection(COLLECTIONS.USER_SETTINGS).find({}).toArray();
    const result = {};

    settings.forEach(setting => {
      const { userId, _id, updatedAt, ...rest } = setting;
      result[userId] = rest;
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting all user settings:', error.message);
    return {};
  }
}

// ============================================================================
// SERVER SETTINGS
// ============================================================================

/**
 * Save server settings
 * @param {string} guildId - Guild ID
 * @param {Object} settings - Settings object
 * @returns {Promise<void>}
 */
export async function saveServerSettings(guildId, settings) {
  try {
    await getCollection(COLLECTIONS.SERVER_SETTINGS).updateOne(
      { guildId },
      { $set: { guildId, ...settings, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving server settings:', error.message);
    throw error;
  }
}

/**
 * Get server settings
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object|null>} Settings or null
 */
export async function getServerSettings(guildId) {
  try {
    const settings = await getCollection(COLLECTIONS.SERVER_SETTINGS).findOne({ guildId });
    return settings || null;
  } catch (error) {
    console.error('❌ Error getting server settings:', error.message);
    return null;
  }
}

/**
 * Get all server settings (for bot initialization)
 * @returns {Promise<Object>} Map of guildId to settings
 */
export async function getAllServerSettings() {
  try {
    const settings = await getCollection(COLLECTIONS.SERVER_SETTINGS).find({}).toArray();
    const result = {};

    settings.forEach(setting => {
      const { guildId, _id, updatedAt, ...rest } = setting;
      result[guildId] = rest;
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting all server settings:', error.message);
    return {};
  }
}

// ============================================================================
// CHAT HISTORIES
// ============================================================================

/**
 * Save chat history
 * @param {string} id - History ID (user/channel/guild)
 * @param {Object} history - History object
 * @returns {Promise<void>}
 */
export async function saveChatHistory(id, history) {
  try {
    await getCollection(COLLECTIONS.CHAT_HISTORIES).updateOne(
      { id },
      { $set: { id, history, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving chat history:', error.message);
    throw error;
  }
}

/**
 * Get chat history
 * @param {string} id - History ID
 * @returns {Promise<Object|null>} History or null
 */
export async function getChatHistory(id) {
  try {
    const record = await getCollection(COLLECTIONS.CHAT_HISTORIES).findOne({ id });
    return record ? record.history : null;
  } catch (error) {
    console.error('❌ Error getting chat history:', error.message);
    return null;
  }
}

/**
 * Get all chat histories (for bot initialization)
 * @returns {Promise<Object>} Map of id to history
 */
export async function getAllChatHistories() {
  try {
    const histories = await getCollection(COLLECTIONS.CHAT_HISTORIES).find({}).toArray();
    const result = {};

    histories.forEach(history => {
      result[history.id] = history.history;
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting all chat histories:', error.message);
    return {};
  }
}

/**
 * Delete chat history
 * @param {string} id - History ID
 * @returns {Promise<void>}
 */
export async function deleteChatHistory(id) {
  try {
    await getCollection(COLLECTIONS.CHAT_HISTORIES).deleteOne({ id });
  } catch (error) {
    console.error('❌ Error deleting chat history:', error.message);
    throw error;
  }
}

// ============================================================================
// CUSTOM INSTRUCTIONS
// ============================================================================

/**
 * Save custom instructions
 * @param {string} id - User/channel/guild ID
 * @param {string} instructions - Custom instructions text
 * @returns {Promise<void>}
 */
export async function saveCustomInstructions(id, instructions) {
  try {
    await getCollection(COLLECTIONS.CUSTOM_INSTRUCTIONS).updateOne(
      { id },
      { $set: { id, instructions, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving custom instructions:', error.message);
    throw error;
  }
}

/**
 * Get custom instructions
 * @param {string} id - User/channel/guild ID
 * @returns {Promise<string|null>} Instructions or null
 */
export async function getCustomInstructions(id) {
  try {
    const record = await getCollection(COLLECTIONS.CUSTOM_INSTRUCTIONS).findOne({ id });
    return record ? record.instructions : null;
  } catch (error) {
    console.error('❌ Error getting custom instructions:', error.message);
    return null;
  }
}

/**
 * Get all custom instructions (for bot initialization)
 * @returns {Promise<Object>} Map of id to instructions
 */
export async function getAllCustomInstructions() {
  try {
    const instructions = await getCollection(COLLECTIONS.CUSTOM_INSTRUCTIONS).find({}).toArray();
    const result = {};

    instructions.forEach(instruction => {
      result[instruction.id] = instruction.instructions;
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting all custom instructions:', error.message);
    return {};
  }
}

// ============================================================================
// BLACKLISTED USERS
// ============================================================================

/**
 * Save blacklisted users for a guild
 * @param {string} guildId - Guild ID
 * @param {string[]} users - Array of user IDs
 * @returns {Promise<void>}
 */
export async function saveBlacklistedUsers(guildId, users) {
  try {
    await getCollection(COLLECTIONS.BLACKLISTED_USERS).updateOne(
      { guildId },
      { $set: { guildId, users, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving blacklisted users:', error.message);
    throw error;
  }
}

/**
 * Get blacklisted users for a guild
 * @param {string} guildId - Guild ID
 * @returns {Promise<string[]|null>} Array of user IDs or null
 */
export async function getBlacklistedUsers(guildId) {
  try {
    const record = await getCollection(COLLECTIONS.BLACKLISTED_USERS).findOne({ guildId });
    return record ? record.users : null;
  } catch (error) {
    console.error('❌ Error getting blacklisted users:', error.message);
    return null;
  }
}

/**
 * Get all blacklisted users (for bot initialization)
 * @returns {Promise<Object>} Map of guildId to user arrays
 */
export async function getAllBlacklistedUsers() {
  try {
    const blacklists = await getCollection(COLLECTIONS.BLACKLISTED_USERS).find({}).toArray();
    const result = {};

    blacklists.forEach(blacklist => {
      result[blacklist.guildId] = blacklist.users;
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting all blacklisted users:', error.message);
    return {};
  }
}

// ============================================================================
// CHANNEL SETTINGS
// ============================================================================

/**
 * Save channel setting
 * @param {string} channelId - Channel ID
 * @param {string} settingType - Setting type (e.g., 'alwaysRespond', 'wideChatHistory')
 * @param {any} value - Setting value
 * @returns {Promise<void>}
 */
export async function saveChannelSetting(channelId, settingType, value) {
  try {
    await getCollection(COLLECTIONS.CHANNEL_SETTINGS).updateOne(
      { channelId },
      { $set: { channelId, [settingType]: value, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving channel setting:', error.message);
    throw error;
  }
}

/**
 * Get channel setting
 * @param {string} channelId - Channel ID
 * @param {string} settingType - Setting type
 * @returns {Promise<any>} Setting value or null
 */
export async function getChannelSetting(channelId, settingType) {
  try {
    const record = await getCollection(COLLECTIONS.CHANNEL_SETTINGS).findOne({ channelId });
    return record ? record[settingType] : null;
  } catch (error) {
    console.error('❌ Error getting channel setting:', error.message);
    return null;
  }
}

/**
 * Get all channel settings of a specific type
 * @param {string} settingType - Setting type
 * @returns {Promise<Object>} Map of channelId to setting value
 */
export async function getAllChannelSettings(settingType) {
  try {
    const settings = await getCollection(COLLECTIONS.CHANNEL_SETTINGS).find({}).toArray();
    const result = {};

    settings.forEach(setting => {
      if (setting[settingType] !== undefined) {
        result[setting.channelId] = setting[settingType];
      }
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting all channel settings:', error.message);
    return {};
  }
}

// ============================================================================
// ACTIVE USERS IN CHANNELS
// ============================================================================

/**
 * Save active users in channels tracking data
 * @param {Object} data - Active users data
 * @returns {Promise<void>}
 */
export async function saveActiveUsersInChannels(data) {
  try {
    await getCollection(COLLECTIONS.ACTIVE_USERS).updateOne(
      { _id: 'active_users' },
      { $set: { data, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving active users:', error.message);
    throw error;
  }
}

/**
 * Get active users in channels tracking data
 * @returns {Promise<Object>} Active users data
 */
export async function getActiveUsersInChannels() {
  try {
    const record = await getCollection(COLLECTIONS.ACTIVE_USERS).findOne({ _id: 'active_users' });
    return record ? record.data : {};
  } catch (error) {
    console.error('❌ Error getting active users:', error.message);
    return {};
  }
}

// ============================================================================
// USER RESPONSE PREFERENCES
// ============================================================================

/**
 * Save user response preference
 * @param {string} userId - User ID
 * @param {string} preference - Response preference
 * @returns {Promise<void>}
 */
export async function saveUserResponsePreference(userId, preference) {
  try {
    await getCollection(COLLECTIONS.USER_RESPONSE_PREF).updateOne(
      { userId },
      { $set: { userId, preference, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving user response preference:', error.message);
    throw error;
  }
}

/**
 * Get user response preference
 * @param {string} userId - User ID
 * @returns {Promise<string|null>} Preference or null
 */
export async function getUserResponsePreference(userId) {
  try {
    const record = await getCollection(COLLECTIONS.USER_RESPONSE_PREF).findOne({ userId });
    return record ? record.preference : null;
  } catch (error) {
    console.error('❌ Error getting user response preference:', error.message);
    return null;
  }
}

/**
 * Get all user response preferences
 * @returns {Promise<Object>} Map of userId to preference
 */
export async function getAllUserResponsePreferences() {
  try {
    const prefs = await getCollection(COLLECTIONS.USER_RESPONSE_PREF).find({}).toArray();
    const result = {};

    prefs.forEach(pref => {
      result[pref.userId] = pref.preference;
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting all user response preferences:', error.message);
    return {};
  }
}

// ============================================================================
// MEMORY SYSTEM
// ============================================================================

/**
 * Save memory entry for RAG system
 * @param {string} historyId - History ID
 * @param {Object} entry - Memory entry with embedding
 * @returns {Promise<void>}
 */
export async function saveMemoryEntry(historyId, entry) {
  try {
    await getCollection(COLLECTIONS.MEMORY_ENTRIES).insertOne({
      ...entry,
      metadata: entry.metadata || { historyId },
      createdAt: new Date()
    });
  } catch (error) {
    console.error('❌ Error saving memory entry:', error.message);
    throw error;
  }
}

/**
 * Get memory entries for a history
 * @param {string} historyId - History ID
 * @param {number} [limit=50] - Maximum entries to return
 * @returns {Promise<Array>} Memory entries
 */
export async function getMemoryEntries(historyId, limit = 50) {
  try {
    const entries = await getCollection(COLLECTIONS.MEMORY_ENTRIES)
      .find({ 'metadata.historyId': historyId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    return entries;
  } catch (error) {
    console.error('❌ Error getting memory entries:', error.message);
    return [];
  }
}

/**
 * Delete old memory entries (for cleanup)
 * @param {number} cutoffTimestamp - Delete entries older than this timestamp
 * @returns {Promise<number>} Number of deleted entries
 */
export async function deleteOldMemoryEntries(cutoffTimestamp) {
  try {
    const result = await getCollection(COLLECTIONS.MEMORY_ENTRIES)
      .deleteMany({ timestamp: { $lt: cutoffTimestamp } });

    return result.deletedCount;
  } catch (error) {
    console.error('❌ Error deleting old memory entries:', error.message);
    return 0;
  }
}

// ============================================================================
// IMAGE USAGE TRACKING
// ============================================================================

/**
 * Save image usage data
 * @param {string} userId - User ID
 * @param {Object} usageData - Usage data
 * @returns {Promise<void>}
 */
export async function saveImageUsage(userId, usageData) {
  try {
    await getCollection(COLLECTIONS.IMAGE_USAGE).updateOne(
      { userId },
      { $set: { userId, ...usageData, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving image usage:', error.message);
    throw error;
  }
}

/**
 * Get all image usages
 * @returns {Promise<Object>} Map of userId to usage data
 */
export async function getAllImageUsages() {
  try {
    const usages = await getCollection(COLLECTIONS.IMAGE_USAGE).find({}).toArray();
    const result = {};

    usages.forEach(u => {
      result[u.userId] = {
        count: u.count,
        lastReset: u.lastReset,
        lastRequest: u.lastRequest
      };
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting all image usages:', error.message);
    return {};
  }
}

// ============================================================================
// BIRTHDAYS
// ============================================================================

/**
 * Save birthday
 * @param {string} userId - User ID
 * @param {Object} data - Birthday data
 * @returns {Promise<void>}
 */
export async function saveBirthday(userId, data) {
  try {
    await getCollection(COLLECTIONS.BIRTHDAYS).updateOne(
      { userId },
      { $set: { userId, ...data, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving birthday:', error.message);
    throw error;
  }
}

/**
 * Get all birthdays
 * @returns {Promise<Object>} Map of userId to birthday data
 */
export async function getAllBirthdays() {
  try {
    const birthdays = await getCollection(COLLECTIONS.BIRTHDAYS).find({}).toArray();
    const result = {};

    birthdays.forEach(birthday => {
      const { userId, _id, updatedAt, ...rest } = birthday;
      result[userId] = rest;
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting birthdays:', error.message);
    return {};
  }
}

/**
 * Delete birthday
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
export async function deleteBirthday(userId) {
  try {
    await getCollection(COLLECTIONS.BIRTHDAYS).deleteOne({ userId });
  } catch (error) {
    console.error('❌ Error deleting birthday:', error.message);
    throw error;
  }
}

// ============================================================================
// REMINDERS
// ============================================================================

/**
 * Save reminder
 * @param {string} userId - User ID
 * @param {Object} reminder - Reminder data
 * @returns {Promise<void>}
 */
export async function saveReminder(userId, reminder) {
  try {
    await getCollection(COLLECTIONS.REMINDERS).insertOne({
      userId,
      ...reminder,
      createdAt: new Date()
    });
  } catch (error) {
    console.error('❌ Error saving reminder:', error.message);
    throw error;
  }
}

/**
 * Get all reminders
 * @returns {Promise<Object>} Map of userId to reminders array
 */
export async function getAllReminders() {
  try {
    const reminders = await getCollection(COLLECTIONS.REMINDERS)
      .find({ active: true })
      .toArray();

    const result = {};

    reminders.forEach(reminder => {
      if (!result[reminder.userId]) {
        result[reminder.userId] = [];
      }
      result[reminder.userId].push(reminder);
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting reminders:', error.message);
    return {};
  }
}

/**
 * Update reminder
 * @param {string} reminderId - Reminder ID
 * @param {Object} updates - Update data
 * @returns {Promise<void>}
 */
export async function updateReminder(reminderId, updates) {
  try {
    await getCollection(COLLECTIONS.REMINDERS).updateOne(
      { id: reminderId },
      { $set: updates }
    );
  } catch (error) {
    console.error('❌ Error updating reminder:', error.message);
    throw error;
  }
}

/**
 * Delete reminder
 * @param {string} reminderId - Reminder ID
 * @returns {Promise<void>}
 */
export async function deleteReminder(reminderId) {
  try {
    await getCollection(COLLECTIONS.REMINDERS).deleteOne({ id: reminderId });
  } catch (error) {
    console.error('❌ Error deleting reminder:', error.message);
    throw error;
  }
}

// ============================================================================
// DAILY QUOTES
// ============================================================================

/**
 * Save daily quote configuration
 * @param {string} userId - User ID
 * @param {Object} config - Quote configuration
 * @returns {Promise<void>}
 */
export async function saveDailyQuote(userId, config) {
  try {
    await getCollection(COLLECTIONS.DAILY_QUOTES).updateOne(
      { userId },
      { $set: { userId, ...config, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving daily quote:', error.message);
    throw error;
  }
}

/**
 * Get all daily quotes
 * @returns {Promise<Object>} Map of userId to quote config
 */
export async function getAllDailyQuotes() {
  try {
    const quotes = await getCollection(COLLECTIONS.DAILY_QUOTES)
      .find({ active: true })
      .toArray();

    const result = {};

    quotes.forEach(quote => {
      const { userId, _id, updatedAt, ...rest } = quote;
      result[userId] = rest;
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting daily quotes:', error.message);
    return {};
  }
}

/**
 * Delete daily quote
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
export async function deleteDailyQuote(userId) {
  try {
    await getCollection(COLLECTIONS.DAILY_QUOTES).deleteOne({ userId });
  } catch (error) {
    console.error('❌ Error deleting daily quote:', error.message);
    throw error;
  }
}

// ============================================================================
// ROULETTE CONFIGURATIONS
// ============================================================================

/**
 * Save roulette configuration
 * @param {string} channelId - Channel ID
 * @param {Object} config - Roulette configuration
 * @returns {Promise<void>}
 */
export async function saveRouletteConfig(channelId, config) {
  try {
    await getCollection(COLLECTIONS.ROULETTE).updateOne(
      { channelId },
      { $set: { channelId, ...config, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving roulette config:', error.message);
    throw error;
  }
}

/**
 * Get all roulette configurations
 * @returns {Promise<Object>} Map of channelId to config
 */
export async function getAllRouletteConfigs() {
  try {
    const configs = await getCollection(COLLECTIONS.ROULETTE).find({}).toArray();
    const result = {};

    configs.forEach(config => {
      const { channelId, _id, updatedAt, ...rest } = config;
      result[channelId] = rest;
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting roulette configs:', error.message);
    return {};
  }
}

// ============================================================================
// COMPLIMENTS
// ============================================================================

/**
 * Save compliment count
 * @param {string} userId - User ID
 * @param {number} count - Compliment count
 * @returns {Promise<void>}
 */
export async function saveComplimentCount(userId, count) {
  try {
    await getCollection(COLLECTIONS.COMPLIMENTS).updateOne(
      { userId },
      { $set: { userId, count, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving compliment count:', error.message);
    throw error;
  }
}

/**
 * Get all compliment counts
 * @returns {Promise<Object>} Map of userId to count
 */
export async function getAllComplimentCounts() {
  try {
    const counts = await getCollection(COLLECTIONS.COMPLIMENTS).find({}).toArray();
    const result = {};

    counts.forEach(c => {
      result[c.userId] = c.count;
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting compliment counts:', error.message);
    return {};
  }
}

/**
 * Save compliment opt-out status
 * @param {string} userId - User ID
 * @param {boolean} optedOut - Opt-out status
 * @returns {Promise<void>}
 */
export async function saveComplimentOptOut(userId, optedOut) {
  try {
    if (optedOut) {
      await getCollection(COLLECTIONS.COMPLIMENT_OPT_OUT).updateOne(
        { userId },
        { $set: { userId, optedOut: true, updatedAt: new Date() } },
        { upsert: true }
      );
    } else {
      await getCollection(COLLECTIONS.COMPLIMENT_OPT_OUT).deleteOne({ userId });
    }
  } catch (error) {
    console.error('❌ Error saving compliment opt-out:', error.message);
    throw error;
  }
}

/**
 * Get all compliment opt-outs
 * @returns {Promise<Object>} Map of userId to true (opted out)
 */
export async function getAllComplimentOptOuts() {
  try {
    const optOuts = await getCollection(COLLECTIONS.COMPLIMENT_OPT_OUT).find({}).toArray();
    const result = {};

    optOuts.forEach(o => {
      result[o.userId] = true;
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting compliment opt-outs:', error.message);
    return {};
  }
}

// ============================================================================
// TIMEZONES
// ============================================================================

/**
 * Save user timezone
 * @param {string} userId - User ID
 * @param {string} timezone - IANA timezone string
 * @returns {Promise<void>}
 */
export async function saveUserTimezone(userId, timezone) {
  try {
    await getCollection(COLLECTIONS.USER_TIMEZONES).updateOne(
      { userId },
      { $set: { userId, timezone, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving user timezone:', error.message);
    throw error;
  }
}

/**
 * Get user timezone
 * @param {string} userId - User ID
 * @returns {Promise<string|null>} Timezone or null
 */
export async function getUserTimezone(userId) {
  try {
    const doc = await getCollection(COLLECTIONS.USER_TIMEZONES).findOne({ userId });
    return doc?.timezone || null;
  } catch (error) {
    console.error('❌ Error getting user timezone:', error.message);
    return null;
  }
}

/**
 * Get all user timezones
 * @returns {Promise<Object>} Map of userId to timezone
 */
export async function getAllUserTimezones() {
  try {
    const docs = await getCollection(COLLECTIONS.USER_TIMEZONES).find({}).toArray();
    const result = {};

    docs.forEach(doc => {
      result[doc.userId] = doc.timezone;
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting all user timezones:', error.message);
    return {};
  }
}

// ============================================================================
// SERVER DIGESTS
// ============================================================================

/**
 * Save server digest
 * @param {string} guildId - Guild ID
 * @param {Object} digest - Digest data
 * @returns {Promise<void>}
 */
export async function saveServerDigest(guildId, digest) {
  try {
    await getCollection(COLLECTIONS.SERVER_DIGESTS).updateOne(
      { guildId },
      { $set: { guildId, ...digest, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving server digest:', error.message);
    throw error;
  }
}

/**
 * Get server digest
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object|null>} Digest data or null
 */
export async function getServerDigest(guildId) {
  try {
    const doc = await getCollection(COLLECTIONS.SERVER_DIGESTS).findOne({ guildId });
    if (!doc) return null;

    return {
      timestamp: doc.timestamp,
      messageCount: doc.messageCount,
      summary: doc.summary,
      daysAnalyzed: doc.daysAnalyzed
    };
  } catch (error) {
    console.error('❌ Error getting server digest:', error.message);
    return null;
  }
}

/**
 * Get all server digests
 * @returns {Promise<Object>} Map of guildId to digest
 */
export async function getAllServerDigests() {
  try {
    const docs = await getCollection(COLLECTIONS.SERVER_DIGESTS).find({}).toArray();
    const result = {};

    docs.forEach(doc => {
      result[doc.guildId] = {
        timestamp: doc.timestamp,
        messageCount: doc.messageCount,
        summary: doc.summary,
        daysAnalyzed: doc.daysAnalyzed
      };
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting all server digests:', error.message);
    return {};
  }
}

// ============================================================================
// QUOTE USAGE TRACKING
// ============================================================================

/**
 * Save quote usage
 * @param {string} userId - User ID
 * @param {Object} usage - Usage data
 * @returns {Promise<void>}
 */
export async function saveQuoteUsage(userId, usage) {
  try {
    await getCollection('quoteUsage').updateOne(
      { userId },
      { $set: { userId, count: usage.count, lastReset: usage.lastReset, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving quote usage:', error.message);
    throw error;
  }
}

/**
 * Get quote usage
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Usage data or null
 */
export async function getQuoteUsage(userId) {
  try {
    const doc = await getCollection('quoteUsage').findOne({ userId });
    if (!doc) return null;

    return {
      count: doc.count,
      lastReset: doc.lastReset
    };
  } catch (error) {
    console.error('❌ Error getting quote usage:', error.message);
    return null;
  }
}

/**
 * Get all quote usages
 * @returns {Promise<Object>} Map of userId to usage data
 */
export async function getAllQuoteUsages() {
  try {
    const docs = await getCollection('quoteUsage').find({}).toArray();
    const result = {};

    docs.forEach(doc => {
      result[doc.userId] = {
        count: doc.count,
        lastReset: doc.lastReset
      };
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting all quote usages:', error.message);
    return {};
  }
}

// ============================================================================
// REALIVE CONFIGURATIONS
// ============================================================================

/**
 * Save realive configuration
 * @param {string} guildId - Guild ID
 * @param {Object} config - Realive configuration
 * @returns {Promise<void>}
 */
export async function saveRealiveConfig(guildId, config) {
  try {
    await getCollection(COLLECTIONS.REALIVE).updateOne(
      { guildId },
      { $set: { guildId, ...config, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving realive config:', error.message);
    throw error;
  }
}

/**
 * Get all realive configurations
 * @returns {Promise<Object>} Map of guildId to config
 */
export async function getAllRealiveConfigs() {
  try {
    const configs = await getCollection(COLLECTIONS.REALIVE).find({}).toArray();
    const result = {};

    configs.forEach(config => {
      const { guildId, _id, updatedAt, ...rest } = config;
      result[guildId] = rest;
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting realive configs:', error.message);
    return {};
  }
}

// ============================================================================
// SUMMARY USAGE TRACKING
// ============================================================================

/**
 * Save summary usage
 * @param {string} userId - User ID
 * @param {Object} usage - Usage data
 * @returns {Promise<void>}
 */
export async function saveSummaryUsage(userId, usage) {
  try {
    await getCollection(COLLECTIONS.SUMMARY_USAGE).updateOne(
      { userId },
      { $set: { userId, ...usage, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error('❌ Error saving summary usage:', error.message);
    throw error;
  }
}

/**
 * Get all summary usages
 * @returns {Promise<Object>} Map of userId to usage data
 */
export async function getAllSummaryUsages() {
  try {
    const usages = await getCollection(COLLECTIONS.SUMMARY_USAGE).find({}).toArray();
    const result = {};

    usages.forEach(u => {
      result[u.userId] = {
        count: u.count,
        lastReset: u.lastReset
      };
    });

    return result;
  } catch (error) {
    console.error('❌ Error getting summary usages:', error.message);
    return {};
  }
}

// ============================================================================
// USER FACTS (PERSONAL MEMORY)
// ============================================================================

/**
 * Save user fact for personal memory
 * @param {string} userId - User ID
 * @param {string} fact - Fact to remember
 * @returns {Promise<void>}
 */
export async function saveUserFact(userId, fact) {
  try {
    await getCollection(COLLECTIONS.USER_FACTS).insertOne({
      userId,
      fact,
      createdAt: new Date()
    });
  } catch (error) {
    console.error('❌ Error saving user fact:', error.message);
    throw error;
  }
}

/**
 * Get user facts
 * @param {string} userId - User ID
 * @returns {Promise<string[]>} Array of facts
 */
export async function getUserFacts(userId) {
  try {
    const docs = await getCollection(COLLECTIONS.USER_FACTS)
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    return docs.map(d => d.fact);
  } catch (error) {
    console.error('❌ Error getting user facts:', error.message);
    return [];
  }
}

/**
 * Delete user fact by keyword
 * @param {string} userId - User ID
 * @param {string} factKeyword - Keyword to match for deletion
 * @returns {Promise<number>} Number of facts deleted
 */
export async function deleteUserFact(userId, factKeyword) {
  try {
    const result = await getCollection(COLLECTIONS.USER_FACTS).deleteMany({
      userId,
      fact: { $regex: factKeyword, $options: 'i' }
    });

    return result.deletedCount;
  } catch (error) {
    console.error('❌ Error deleting user fact:', error.message);
    return 0;
  }
}

// ============================================================================
// BATCH OPERATIONS (FOR PERFORMANCE)
// ============================================================================

/**
 * Save multiple entities in parallel
 * Used during bot initialization saves
 * 
 * @param {Object} options - Batch save options
 * @param {Object} [options.userSettings] - User settings to save
 * @param {Object} [options.serverSettings] - Server settings to save
 * @param {Object} [options.chatHistories] - Chat histories to save
 * @returns {Promise<Object>} Results summary
 */
export async function batchSave(options = {}) {
  const operations = [];
  const results = {
    saved: 0,
    failed: 0,
    errors: []
  };

  try {
    // User settings
    if (options.userSettings) {
      for (const [userId, settings] of Object.entries(options.userSettings)) {
        operations.push(
          saveUserSettings(userId, settings)
            .then(() => results.saved++)
            .catch(err => {
              results.failed++;
              results.errors.push({ type: 'userSettings', id: userId, error: err.message });
            })
        );
      }
    }

    // Server settings
    if (options.serverSettings) {
      for (const [guildId, settings] of Object.entries(options.serverSettings)) {
        operations.push(
          saveServerSettings(guildId, settings)
            .then(() => results.saved++)
            .catch(err => {
              results.failed++;
              results.errors.push({ type: 'serverSettings', id: guildId, error: err.message });
            })
        );
      }
    }

    // Chat histories
    if (options.chatHistories) {
      for (const [id, history] of Object.entries(options.chatHistories)) {
        operations.push(
          saveChatHistory(id, history)
            .then(() => results.saved++)
            .catch(err => {
              results.failed++;
              results.errors.push({ type: 'chatHistory', id, error: err.message });
            })
        );
      }
    }

    // Execute all operations in parallel
    await Promise.all(operations);

    return results;

  } catch (error) {
    console.error('❌ Batch save critical error:', error.message);
    throw error;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  connectDB,
  closeDB,
  getDB,
  
  // Vector search
  findSimilarMemories,
  findSimilarMemoriesWithFilter,
  
  // Personal data helpers
  getBirthday,
  getUserReminders,
  getComplimentCount,
  getUserDailyQuote,
  
  // User settings
  saveUserSettings,
  getUserSettings,
  getAllUserSettings,
  
  // Server settings
  saveServerSettings,
  getServerSettings,
  getAllServerSettings,
  
  // Chat histories
  saveChatHistory,
  getChatHistory,
  getAllChatHistories,
  deleteChatHistory,
  
  // Custom instructions
  saveCustomInstructions,
  getCustomInstructions,
  getAllCustomInstructions,
  
  // Blacklisted users
  saveBlacklistedUsers,
  getBlacklistedUsers,
  getAllBlacklistedUsers,
  
  // Channel settings
  saveChannelSetting,
  getChannelSetting,
  getAllChannelSettings,
  
  // Active users
  saveActiveUsersInChannels,
  getActiveUsersInChannels,
  
  // User response preferences
  saveUserResponsePreference,
  getUserResponsePreference,
  getAllUserResponsePreferences,
  
  // Memory system
  saveMemoryEntry,
  getMemoryEntries,
  deleteOldMemoryEntries,
  
  // Image usage
  saveImageUsage,
  getAllImageUsages,
  
  // Birthdays
  saveBirthday,
  getAllBirthdays,
  deleteBirthday,
  
  // Reminders
  saveReminder,
  getAllReminders,
  updateReminder,
  deleteReminder,
  
  // Daily quotes
  saveDailyQuote,
  getAllDailyQuotes,
  deleteDailyQuote,
  
  // Roulette
  saveRouletteConfig,
  getAllRouletteConfigs,
  
  // Compliments
  saveComplimentCount,
  getAllComplimentCounts,
  saveComplimentOptOut,
  getAllComplimentOptOuts,
  
  // Timezones
  saveUserTimezone,
  getUserTimezone,
  getAllUserTimezones,
  
  // Server digests
  saveServerDigest,
  getServerDigest,
  getAllServerDigests,
  
  // Quote usage
  saveQuoteUsage,
  getQuoteUsage,
  getAllQuoteUsages,
  
  // Realive
  saveRealiveConfig,
  getAllRealiveConfigs,
  
  // Summary usage
  saveSummaryUsage,
  getAllSummaryUsages,
  
  // User facts
  saveUserFact,
  getUserFacts,
  deleteUserFact,
  
  // Batch operations
  batchSave
};
