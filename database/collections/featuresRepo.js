/**
 * @fileoverview Feature collections repository — birthdays, reminders, daily quotes,
 *               roulette, compliments, timezones, server digests, and realive configs.
 * @module database/collections/featuresRepo
 */

import { Logger }                               from '../../core/Logger.js';
import { COLLECTIONS, getCollection, sanitizeDoc } from '../connection.js';

const logger = Logger.get('FeaturesRepo');

// ============================================================================
// BIRTHDAYS
// ============================================================================

/** @param {string} userId @param {Object} data */
export async function saveBirthday(userId, data) {
  try {
    await getCollection(COLLECTIONS.BIRTHDAYS).updateOne(
      { userId },
      { $set: { userId, ...sanitizeDoc(data), updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving birthday', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of userId → birthday data */
export async function getAllBirthdays() {
  try {
    const docs = await getCollection(COLLECTIONS.BIRTHDAYS).find({}).toArray();
    const result = {};
    docs.forEach(({ userId, _id, updatedAt, ...rest }) => { result[userId] = rest; });
    return result;
  } catch (error) {
    logger.error('Error getting birthdays', error);
    return {};
  }
}

/** @param {string} userId */
export async function deleteBirthday(userId) {
  try {
    await getCollection(COLLECTIONS.BIRTHDAYS).deleteOne({ userId });
  } catch (error) {
    logger.error('Error deleting birthday', error);
    throw error;
  }
}

// ============================================================================
// REMINDERS
// ============================================================================

/** @param {string} userId @param {Object} reminder */
export async function saveReminder(userId, reminder) {
  try {
    await getCollection(COLLECTIONS.REMINDERS).insertOne({
      userId, ...sanitizeDoc(reminder), createdAt: new Date()
    });
  } catch (error) {
    logger.error('Error saving reminder', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of userId → reminder[] */
export async function getAllReminders() {
  try {
    const docs = await getCollection(COLLECTIONS.REMINDERS).find({ active: true }).toArray();
    const result = {};
    docs.forEach(reminder => {
      if (!result[reminder.userId]) result[reminder.userId] = [];
      result[reminder.userId].push(reminder);
    });
    return result;
  } catch (error) {
    logger.error('Error getting reminders', error);
    return {};
  }
}

/**
 * Update specific fields on a reminder document.
 * Sanitized to block operator-key injection through the updates object.
 * @param {string} reminderId @param {Object} updates
 */
export async function updateReminder(reminderId, updates) {
  try {
    await getCollection(COLLECTIONS.REMINDERS).updateOne(
      { id: reminderId },
      { $set: sanitizeDoc(updates) }
    );
  } catch (error) {
    logger.error('Error updating reminder', error);
    throw error;
  }
}

/** @param {string} reminderId */
export async function deleteReminder(reminderId) {
  try {
    await getCollection(COLLECTIONS.REMINDERS).deleteOne({ id: reminderId });
  } catch (error) {
    logger.error('Error deleting reminder', error);
    throw error;
  }
}

// ============================================================================
// DAILY QUOTES
// ============================================================================

/** @param {string} userId @param {Object} config */
export async function saveDailyQuote(userId, config) {
  try {
    await getCollection(COLLECTIONS.DAILY_QUOTES).updateOne(
      { userId },
      { $set: { userId, ...sanitizeDoc(config), updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving daily quote', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of userId → quote config */
export async function getAllDailyQuotes() {
  try {
    const docs = await getCollection(COLLECTIONS.DAILY_QUOTES).find({ active: true }).toArray();
    const result = {};
    docs.forEach(({ userId, _id, updatedAt, ...rest }) => { result[userId] = rest; });
    return result;
  } catch (error) {
    logger.error('Error getting daily quotes', error);
    return {};
  }
}

/** @param {string} userId */
export async function deleteDailyQuote(userId) {
  try {
    await getCollection(COLLECTIONS.DAILY_QUOTES).deleteOne({ userId });
  } catch (error) {
    logger.error('Error deleting daily quote', error);
    throw error;
  }
}

// ============================================================================
// ROULETTE
// ============================================================================

/** @param {string} channelId @param {Object} config */
export async function saveRouletteConfig(channelId, config) {
  try {
    await getCollection(COLLECTIONS.ROULETTE).updateOne(
      { channelId },
      { $set: { channelId, ...sanitizeDoc(config), updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving roulette config', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of channelId → config */
export async function getAllRouletteConfigs() {
  try {
    const docs = await getCollection(COLLECTIONS.ROULETTE).find({}).toArray();
    const result = {};
    docs.forEach(({ channelId, _id, updatedAt, ...rest }) => { result[channelId] = rest; });
    return result;
  } catch (error) {
    logger.error('Error getting roulette configs', error);
    return {};
  }
}

// ============================================================================
// COMPLIMENTS
// ============================================================================

/** @param {string} userId @param {number} count */
export async function saveComplimentCount(userId, count) {
  try {
    await getCollection(COLLECTIONS.COMPLIMENTS).updateOne(
      { userId },
      { $set: { userId, count, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving compliment count', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of userId → count */
export async function getAllComplimentCounts() {
  try {
    const docs = await getCollection(COLLECTIONS.COMPLIMENTS).find({}).toArray();
    const result = {};
    docs.forEach(doc => { result[doc.userId] = doc.count; });
    return result;
  } catch (error) {
    logger.error('Error getting compliment counts', error);
    return {};
  }
}

/** @param {string} userId @param {boolean} optedOut */
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
    logger.error('Error saving compliment opt-out', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of userId → true */
export async function getAllComplimentOptOuts() {
  try {
    const docs = await getCollection(COLLECTIONS.COMPLIMENT_OPT_OUT).find({}).toArray();
    const result = {};
    docs.forEach(doc => { result[doc.userId] = true; });
    return result;
  } catch (error) {
    logger.error('Error getting compliment opt-outs', error);
    return {};
  }
}

// ============================================================================
// TIMEZONES
// ============================================================================

/** @param {string} userId @param {string} timezone */
export async function saveUserTimezone(userId, timezone) {
  try {
    await getCollection(COLLECTIONS.USER_TIMEZONES).updateOne(
      { userId },
      { $set: { userId, timezone, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving user timezone', error);
    throw error;
  }
}

/** @param {string} userId @returns {Promise<string|null>} */
export async function getUserTimezone(userId) {
  try {
    const doc = await getCollection(COLLECTIONS.USER_TIMEZONES).findOne({ userId });
    return doc?.timezone ?? null;
  } catch (error) {
    logger.error('Error getting user timezone', error);
    return null;
  }
}

/** @returns {Promise<Object>} Map of userId → timezone string */
export async function getAllUserTimezones() {
  try {
    const docs = await getCollection(COLLECTIONS.USER_TIMEZONES).find({}).toArray();
    const result = {};
    docs.forEach(doc => { result[doc.userId] = doc.timezone; });
    return result;
  } catch (error) {
    logger.error('Error getting all user timezones', error);
    return {};
  }
}

// ============================================================================
// SERVER DIGESTS
// ============================================================================

/** @param {string} guildId @param {Object} digest */
export async function saveServerDigest(guildId, digest) {
  try {
    await getCollection(COLLECTIONS.SERVER_DIGESTS).updateOne(
      { guildId },
      { $set: { guildId, ...sanitizeDoc(digest), updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving server digest', error);
    throw error;
  }
}

/** @param {string} guildId @returns {Promise<Object|null>} */
export async function getServerDigest(guildId) {
  try {
    const doc = await getCollection(COLLECTIONS.SERVER_DIGESTS).findOne({ guildId });
    if (!doc) return null;
    // Explicit field projection prevents accidentally surfacing internal fields.
    return {
      timestamp:    doc.timestamp,
      messageCount: doc.messageCount,
      summary:      doc.summary,
      daysAnalyzed: doc.daysAnalyzed
    };
  } catch (error) {
    logger.error('Error getting server digest', error);
    return null;
  }
}

/** @returns {Promise<Object>} Map of guildId → digest */
export async function getAllServerDigests() {
  try {
    const docs = await getCollection(COLLECTIONS.SERVER_DIGESTS).find({}).toArray();
    const result = {};
    docs.forEach(doc => {
      result[doc.guildId] = {
        timestamp:    doc.timestamp,
        messageCount: doc.messageCount,
        summary:      doc.summary,
        daysAnalyzed: doc.daysAnalyzed
      };
    });
    return result;
  } catch (error) {
    logger.error('Error getting all server digests', error);
    return {};
  }
}

// ============================================================================
// REALIVE
// ============================================================================

/** @param {string} guildId @param {Object} config */
export async function saveRealiveConfig(guildId, config) {
  try {
    await getCollection(COLLECTIONS.REALIVE).updateOne(
      { guildId },
      { $set: { guildId, ...sanitizeDoc(config), updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving realive config', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of guildId → config */
export async function getAllRealiveConfigs() {
  try {
    const docs = await getCollection(COLLECTIONS.REALIVE).find({}).toArray();
    const result = {};
    docs.forEach(({ guildId, _id, updatedAt, ...rest }) => { result[guildId] = rest; });
    return result;
  } catch (error) {
    logger.error('Error getting realive configs', error);
    return {};
  }
}


// ============================================================================
// BIRTHDAYS
// ============================================================================

/** @param {string} userId @param {Object} data */
export async function saveBirthday(userId, data) {
  try {
    await getCollection(COLLECTIONS.BIRTHDAYS).updateOne(
      { userId },
      { $set: { userId, ...data, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving birthday', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of userId → birthday data */
export async function getAllBirthdays() {
  try {
    const docs = await getCollection(COLLECTIONS.BIRTHDAYS).find({}).toArray();
    const result = {};
    docs.forEach(({ userId, _id, updatedAt, ...rest }) => { result[userId] = rest; });
    return result;
  } catch (error) {
    logger.error('Error getting birthdays', error);
    return {};
  }
}

/** @param {string} userId */
export async function deleteBirthday(userId) {
  try {
    await getCollection(COLLECTIONS.BIRTHDAYS).deleteOne({ userId });
  } catch (error) {
    logger.error('Error deleting birthday', error);
    throw error;
  }
}

// ============================================================================
// REMINDERS
// ============================================================================

/** @param {string} userId @param {Object} reminder */
export async function saveReminder(userId, reminder) {
  try {
    await getCollection(COLLECTIONS.REMINDERS).insertOne({
      userId, ...reminder, createdAt: new Date()
    });
  } catch (error) {
    logger.error('Error saving reminder', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of userId → reminder[] */
export async function getAllReminders() {
  try {
    const docs = await getCollection(COLLECTIONS.REMINDERS).find({ active: true }).toArray();
    const result = {};
    docs.forEach(reminder => {
      if (!result[reminder.userId]) result[reminder.userId] = [];
      result[reminder.userId].push(reminder);
    });
    return result;
  } catch (error) {
    logger.error('Error getting reminders', error);
    return {};
  }
}

/** @param {string} reminderId @param {Object} updates */
export async function updateReminder(reminderId, updates) {
  try {
    await getCollection(COLLECTIONS.REMINDERS).updateOne({ id: reminderId }, { $set: updates });
  } catch (error) {
    logger.error('Error updating reminder', error);
    throw error;
  }
}

/** @param {string} reminderId */
export async function deleteReminder(reminderId) {
  try {
    await getCollection(COLLECTIONS.REMINDERS).deleteOne({ id: reminderId });
  } catch (error) {
    logger.error('Error deleting reminder', error);
    throw error;
  }
}

// ============================================================================
// DAILY QUOTES
// ============================================================================

/** @param {string} userId @param {Object} config */
export async function saveDailyQuote(userId, config) {
  try {
    await getCollection(COLLECTIONS.DAILY_QUOTES).updateOne(
      { userId },
      { $set: { userId, ...config, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving daily quote', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of userId → quote config */
export async function getAllDailyQuotes() {
  try {
    const docs = await getCollection(COLLECTIONS.DAILY_QUOTES).find({ active: true }).toArray();
    const result = {};
    docs.forEach(({ userId, _id, updatedAt, ...rest }) => { result[userId] = rest; });
    return result;
  } catch (error) {
    logger.error('Error getting daily quotes', error);
    return {};
  }
}

/** @param {string} userId */
export async function deleteDailyQuote(userId) {
  try {
    await getCollection(COLLECTIONS.DAILY_QUOTES).deleteOne({ userId });
  } catch (error) {
    logger.error('Error deleting daily quote', error);
    throw error;
  }
}

// ============================================================================
// ROULETTE
// ============================================================================

/** @param {string} channelId @param {Object} config */
export async function saveRouletteConfig(channelId, config) {
  try {
    await getCollection(COLLECTIONS.ROULETTE).updateOne(
      { channelId },
      { $set: { channelId, ...config, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving roulette config', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of channelId → config */
export async function getAllRouletteConfigs() {
  try {
    const docs = await getCollection(COLLECTIONS.ROULETTE).find({}).toArray();
    const result = {};
    docs.forEach(({ channelId, _id, updatedAt, ...rest }) => { result[channelId] = rest; });
    return result;
  } catch (error) {
    logger.error('Error getting roulette configs', error);
    return {};
  }
}

// ============================================================================
// COMPLIMENTS
// ============================================================================

/** @param {string} userId @param {number} count */
export async function saveComplimentCount(userId, count) {
  try {
    await getCollection(COLLECTIONS.COMPLIMENTS).updateOne(
      { userId },
      { $set: { userId, count, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving compliment count', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of userId → count */
export async function getAllComplimentCounts() {
  try {
    const docs = await getCollection(COLLECTIONS.COMPLIMENTS).find({}).toArray();
    const result = {};
    docs.forEach(doc => { result[doc.userId] = doc.count; });
    return result;
  } catch (error) {
    logger.error('Error getting compliment counts', error);
    return {};
  }
}

/** @param {string} userId @param {boolean} optedOut */
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
    logger.error('Error saving compliment opt-out', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of userId → true */
export async function getAllComplimentOptOuts() {
  try {
    const docs = await getCollection(COLLECTIONS.COMPLIMENT_OPT_OUT).find({}).toArray();
    const result = {};
    docs.forEach(doc => { result[doc.userId] = true; });
    return result;
  } catch (error) {
    logger.error('Error getting compliment opt-outs', error);
    return {};
  }
}

// ============================================================================
// TIMEZONES
// ============================================================================

/** @param {string} userId @param {string} timezone */
export async function saveUserTimezone(userId, timezone) {
  try {
    await getCollection(COLLECTIONS.USER_TIMEZONES).updateOne(
      { userId },
      { $set: { userId, timezone, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving user timezone', error);
    throw error;
  }
}

/** @param {string} userId @returns {Promise<string|null>} */
export async function getUserTimezone(userId) {
  try {
    const doc = await getCollection(COLLECTIONS.USER_TIMEZONES).findOne({ userId });
    return doc?.timezone ?? null;
  } catch (error) {
    logger.error('Error getting user timezone', error);
    return null;
  }
}

/** @returns {Promise<Object>} Map of userId → timezone string */
export async function getAllUserTimezones() {
  try {
    const docs = await getCollection(COLLECTIONS.USER_TIMEZONES).find({}).toArray();
    const result = {};
    docs.forEach(doc => { result[doc.userId] = doc.timezone; });
    return result;
  } catch (error) {
    logger.error('Error getting all user timezones', error);
    return {};
  }
}

// ============================================================================
// SERVER DIGESTS
// ============================================================================

/** @param {string} guildId @param {Object} digest */
export async function saveServerDigest(guildId, digest) {
  try {
    await getCollection(COLLECTIONS.SERVER_DIGESTS).updateOne(
      { guildId },
      { $set: { guildId, ...digest, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving server digest', error);
    throw error;
  }
}

/** @param {string} guildId @returns {Promise<Object|null>} */
export async function getServerDigest(guildId) {
  try {
    const doc = await getCollection(COLLECTIONS.SERVER_DIGESTS).findOne({ guildId });
    if (!doc) return null;
    return {
      timestamp:    doc.timestamp,
      messageCount: doc.messageCount,
      summary:      doc.summary,
      daysAnalyzed: doc.daysAnalyzed
    };
  } catch (error) {
    logger.error('Error getting server digest', error);
    return null;
  }
}

/** @returns {Promise<Object>} Map of guildId → digest */
export async function getAllServerDigests() {
  try {
    const docs = await getCollection(COLLECTIONS.SERVER_DIGESTS).find({}).toArray();
    const result = {};
    docs.forEach(doc => {
      result[doc.guildId] = {
        timestamp:    doc.timestamp,
        messageCount: doc.messageCount,
        summary:      doc.summary,
        daysAnalyzed: doc.daysAnalyzed
      };
    });
    return result;
  } catch (error) {
    logger.error('Error getting all server digests', error);
    return {};
  }
}

// ============================================================================
// REALIVE
// ============================================================================

/** @param {string} guildId @param {Object} config */
export async function saveRealiveConfig(guildId, config) {
  try {
    await getCollection(COLLECTIONS.REALIVE).updateOne(
      { guildId },
      { $set: { guildId, ...config, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving realive config', error);
    throw error;
  }
}

/** @returns {Promise<Object>} Map of guildId → config */
export async function getAllRealiveConfigs() {
  try {
    const docs = await getCollection(COLLECTIONS.REALIVE).find({}).toArray();
    const result = {};
    docs.forEach(({ guildId, _id, updatedAt, ...rest }) => { result[guildId] = rest; });
    return result;
  } catch (error) {
    logger.error('Error getting realive configs', error);
    return {};
  }
}
