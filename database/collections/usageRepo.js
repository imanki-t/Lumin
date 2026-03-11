/**
 * @fileoverview Usage tracking repository — image generation usage, AI-quote
 *               usage, summary command usage, and user-fact personal memory.
 * @module database/collections/usageRepo
 */

import { Logger }                    from '../../core/Logger.js';
import { COLLECTIONS, getCollection } from '../connection.js';

const logger = Logger.get('UsageRepo');

// ============================================================================
// IMAGE USAGE
// ============================================================================

/** @param {string} userId @param {Object} usageData */
export async function saveImageUsage(userId, usageData) {
  try {
    await getCollection(COLLECTIONS.IMAGE_USAGE).updateOne(
      { userId },
      { $set: { userId, ...usageData, updatedAt: new Date() } },
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
// BUG FIX: original used hardcoded string 'quoteUsage' instead of
// COLLECTIONS.QUOTE_USAGE — now correctly uses the constant.
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
      { $set: { userId, ...usage, updatedAt: new Date() } },
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
 * Delete user facts matching a keyword (case-insensitive regex).
 * @param {string} userId
 * @param {string} factKeyword
 * @returns {Promise<number>} Count of deleted documents
 */
export async function deleteUserFact(userId, factKeyword) {
  try {
    const result = await getCollection(COLLECTIONS.USER_FACTS).deleteMany({
      userId,
      fact: { $regex: factKeyword, $options: 'i' }
    });
    return result.deletedCount;
  } catch (error) {
    logger.error('Error deleting user fact', error);
    return 0;
  }
}
