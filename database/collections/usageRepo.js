/**
 * @fileoverview Usage tracking — image, quote, summary usage counters and user-fact personal memory.
 * @module database/collections/usageRepo
 */

import { Logger }                                from '../../core/Logger.js';
import { COLLECTIONS, getCollection, sanitizeDoc } from '../connection.js';

const logger = Logger.get('UsageRepo');

// Escape regex special characters to prevent ReDoS in deleteUserFact.
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// IMAGE USAGE
// ============================================================================

/** @param {string} userId @param {Object} usageData */
export async function saveImageUsage(userId, usageData) {
  try {
    await getCollection(COLLECTIONS.IMAGE_USAGE).updateOne(
      { userId },
      { $set: { userId, ...sanitizeDoc(usageData), updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving image usage', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of userId → { count, lastReset, lastRequest } */
export async function getAllImageUsages() {
  try {
    const docs = await getCollection(COLLECTIONS.IMAGE_USAGE).find({}).toArray();
    const result = {};
    docs.forEach(u => {
      result[u.userId] = { count: u.count, lastReset: u.lastReset, lastRequest: u.lastRequest };
    });
    return result;
  } catch (error) {
    logger.error('Error getting all image usages', error);
    return {};
  }
}

// ============================================================================
// QUOTE USAGE
// ============================================================================

/** @param {string} userId @param {{ count: number, lastReset: Date }} usage */
export async function saveQuoteUsage(userId, usage) {
  try {
    await getCollection(COLLECTIONS.QUOTE_USAGE).updateOne(
      { userId },
      { $set: { userId, count: usage.count, lastReset: usage.lastReset, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving quote usage', error);
    throw error;
  }
}

/** @param {string} userId @returns {Promise<{ count: number, lastReset: Date }|null>} */
export async function getQuoteUsage(userId) {
  try {
    const doc = await getCollection(COLLECTIONS.QUOTE_USAGE).findOne({ userId });
    if (!doc) return null;
    return { count: doc.count, lastReset: doc.lastReset };
  } catch (error) {
    logger.error('Error getting quote usage', error);
    return null;
  }
}

/** @returns {Promise<Object>} Map of userId → { count, lastReset } */
export async function getAllQuoteUsages() {
  try {
    const docs = await getCollection(COLLECTIONS.QUOTE_USAGE).find({}).toArray();
    const result = {};
    docs.forEach(doc => { result[doc.userId] = { count: doc.count, lastReset: doc.lastReset }; });
    return result;
  } catch (error) {
    logger.error('Error getting all quote usages', error);
    return {};
  }
}

// ============================================================================
// SUMMARY USAGE
// ============================================================================

/** @param {string} userId @param {Object} usage */
export async function saveSummaryUsage(userId, usage) {
  try {
    await getCollection(COLLECTIONS.SUMMARY_USAGE).updateOne(
      { userId },
      { $set: { userId, ...sanitizeDoc(usage), updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving summary usage', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of userId → { count, lastReset } */
export async function getAllSummaryUsages() {
  try {
    const docs = await getCollection(COLLECTIONS.SUMMARY_USAGE).find({}).toArray();
    const result = {};
    docs.forEach(u => { result[u.userId] = { count: u.count, lastReset: u.lastReset }; });
    return result;
  } catch (error) {
    logger.error('Error getting summary usages', error);
    return {};
  }
}

// ============================================================================
// USER FACTS (personal memory)
// ============================================================================

/** @param {string} userId @param {string} fact */
export async function saveUserFact(userId, fact) {
  try {
    await getCollection(COLLECTIONS.USER_FACTS).insertOne({
      userId, fact, createdAt: new Date()
    });
  } catch (error) {
    logger.error('Error saving user fact', error);
    throw error;
  }
}

/**
 * @param {string} userId
 * @returns {Promise<string[]>} Up to 20 most-recent facts
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
    logger.error('Error getting user facts', error);
    return [];
  }
}

/**
 * Delete facts matching a keyword (case-insensitive).
 * FIX: factKeyword is regex-escaped before use to prevent ReDoS attacks via
 * crafted inputs like '(a+)+' which cause catastrophic backtracking in MongoDB.
 * @param {string} userId
 * @param {string} factKeyword
 * @returns {Promise<number>} Count of deleted documents
 */
export async function deleteUserFact(userId, factKeyword) {
  try {
    const safePattern = escapeRegex(String(factKeyword));
    const result = await getCollection(COLLECTIONS.USER_FACTS).deleteMany({
      userId,
      fact: { $regex: safePattern, $options: 'i' }
    });
    return result.deletedCount;
  } catch (error) {
    logger.error('Error deleting user fact', error);
    return 0;
  }
}

// ============================================================================
// SERVER FACTS (shared guild-scoped memory — visible to all users in a server)
// ============================================================================

/**
 * Store a shared fact at the guild level.
 * Server facts are visible to all users in the same server — use for
 * relationship info, group decisions, or other inter-member context.
 * @param {string} guildId
 * @param {string} fact
 */
export async function saveServerFact(guildId, fact) {
  try {
    await getCollection(COLLECTIONS.SERVER_FACTS).insertOne({
      guildId, fact, createdAt: new Date()
    });
  } catch (error) {
    logger.error('Error saving server fact', error);
    throw error;
  }
}

/**
 * Retrieve up to 30 most-recent server-level facts for a guild.
 * @param {string} guildId
 * @returns {Promise<string[]>}
 */
export async function getServerFacts(guildId) {
  try {
    const docs = await getCollection(COLLECTIONS.SERVER_FACTS)
      .find({ guildId })
      .sort({ createdAt: -1 })
      .limit(30)
      .toArray();
    return docs.map(d => d.fact);
  } catch (error) {
    logger.error('Error getting server facts', error);
    return [];
  }
}

/**
 * Delete server facts matching a keyword (case-insensitive, regex-safe).
 * @param {string} guildId
 * @param {string} factKeyword
 * @returns {Promise<number>} Count of deleted documents
 */
export async function deleteServerFact(guildId, factKeyword) {
  try {
    const safePattern = escapeRegex(String(factKeyword));
    const result = await getCollection(COLLECTIONS.SERVER_FACTS).deleteMany({
      guildId,
      fact: { $regex: safePattern, $options: 'i' }
    });
    return result.deletedCount;
  } catch (error) {
    logger.error('Error deleting server fact', error);
    return 0;
  }
}

// ============================================================================
// INDEXED COUNTS (background RAG indexing state persistence)
// Survives bot restarts so MemoryStore doesn't re-index everything from scratch.
// ============================================================================

/**
 * Persist how many messages have been indexed for a given historyId.
 * Uses upsert so it is safe to call on a new historyId.
 * @param {string} historyId
 * @param {number} count
 * @returns {Promise<void>}
 */
export async function saveIndexedCount(historyId, count) {
  try {
    await getCollection(COLLECTIONS.INDEXED_COUNTS).updateOne(
      { historyId },
      { $set: { historyId, count, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving indexed count', error);
    throw error;
  }
}

/**
 * Load all persisted indexing states so MemoryStore can restore its
 * `lastIndexedCount` map on startup.
 * @returns {Promise<{ historyId: string, count: number }[]>}
 */
export async function getIndexedCounts() {
  try {
    return await getCollection(COLLECTIONS.INDEXED_COUNTS)
      .find({}, { projection: { historyId: 1, count: 1, _id: 0 } })
      .toArray();
  } catch (error) {
    logger.error('Error getting indexed counts', error);
    return [];
  }
}
