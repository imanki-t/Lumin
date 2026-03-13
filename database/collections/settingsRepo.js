/**
 * @fileoverview Settings repository — user settings, server settings,
 *               custom instructions, blacklisted users, channel settings,
 *               active users in channels, and user response preferences.
 * @module database/collections/settingsRepo
 */

import { Logger }              from '../../core/Logger.js';
import { COLLECTIONS, getCollection } from '../connection.js';

const logger = Logger.get('SettingsRepo');

// ============================================================================
// USER SETTINGS
// ============================================================================

/** @param {string} userId @param {Object} settings */
export async function saveUserSettings(userId, settings) {
  try {
    // Use replaceOne (not $set) so fields deleted from in-memory state are
    // also removed from the DB document — $set only adds/updates, never removes.
    await getCollection(COLLECTIONS.USER_SETTINGS).replaceOne(
      { userId },
      { userId, ...settings, updatedAt: new Date() },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving user settings', error);
    throw error;
  }
}

/** @param {string} userId @returns {Promise<Object|null>} */
export async function getUserSettings(userId) {
  try {
    return await getCollection(COLLECTIONS.USER_SETTINGS).findOne({ userId }) ?? null;
  } catch (error) {
    logger.error('Error getting user settings', error);
    return null;
  }
}

/** @returns {Promise<Object>} Map of userId → settings */
export async function getAllUserSettings() {
  try {
    const docs = await getCollection(COLLECTIONS.USER_SETTINGS).find({}).toArray();
    const result = {};
    docs.forEach(({ userId, _id, updatedAt, ...rest }) => { result[userId] = rest; });
    return result;
  } catch (error) {
    logger.error('Error getting all user settings', error);
    return {};
  }
}

// ============================================================================
// SERVER SETTINGS
// ============================================================================

/** @param {string} guildId @param {Object} settings */
export async function saveServerSettings(guildId, settings) {
  try {
    // Use replaceOne (not $set) so fields deleted from in-memory state are
    // also removed from the DB document — $set only adds/updates, never removes.
    await getCollection(COLLECTIONS.SERVER_SETTINGS).replaceOne(
      { guildId },
      { guildId, ...settings, updatedAt: new Date() },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving server settings', error);
    throw error;
  }
}

/** @param {string} guildId @returns {Promise<Object|null>} */
export async function getServerSettings(guildId) {
  try {
    return await getCollection(COLLECTIONS.SERVER_SETTINGS).findOne({ guildId }) ?? null;
  } catch (error) {
    logger.error('Error getting server settings', error);
    return null;
  }
}

/** @returns {Promise<Object>} Map of guildId → settings */
export async function getAllServerSettings() {
  try {
    const docs = await getCollection(COLLECTIONS.SERVER_SETTINGS).find({}).toArray();
    const result = {};
    docs.forEach(({ guildId, _id, updatedAt, ...rest }) => { result[guildId] = rest; });
    return result;
  } catch (error) {
    logger.error('Error getting all server settings', error);
    return {};
  }
}

// ============================================================================
// CUSTOM INSTRUCTIONS
// ============================================================================

/** @param {string} id @param {string|null} instructions */
export async function saveCustomInstructions(id, instructions) {
  try {
    if (instructions === null || instructions === undefined) {
      // Fully remove the document so it doesn't ghost back on restart.
      await getCollection(COLLECTIONS.CUSTOM_INSTRUCTIONS).deleteOne({ id });
    } else {
      await getCollection(COLLECTIONS.CUSTOM_INSTRUCTIONS).replaceOne(
        { id },
        { id, instructions, updatedAt: new Date() },
        { upsert: true }
      );
    }
  } catch (error) {
    logger.error('Error saving custom instructions', error);
    throw error;
  }
}

/** @param {string} id @returns {Promise<string|null>} */
export async function getCustomInstructions(id) {
  try {
    const doc = await getCollection(COLLECTIONS.CUSTOM_INSTRUCTIONS).findOne({ id });
    return doc?.instructions ?? null;
  } catch (error) {
    logger.error('Error getting custom instructions', error);
    return null;
  }
}

/** @returns {Promise<Object>} Map of id → instructions */
export async function getAllCustomInstructions() {
  try {
    const docs = await getCollection(COLLECTIONS.CUSTOM_INSTRUCTIONS).find({}).toArray();
    const result = {};
    docs.forEach(doc => {
      // Skip documents where instructions were nulled out but not yet cleaned up.
      if (doc.instructions != null) result[doc.id] = doc.instructions;
    });
    return result;
  } catch (error) {
    logger.error('Error getting all custom instructions', error);
    return {};
  }
}

// ============================================================================
// BLACKLISTED USERS
// ============================================================================

/** @param {string} guildId @param {string[]} users */
export async function saveBlacklistedUsers(guildId, users) {
  try {
    await getCollection(COLLECTIONS.BLACKLISTED_USERS).updateOne(
      { guildId },
      { $set: { guildId, users, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving blacklisted users', error);
    throw error;
  }
}

/** @param {string} guildId @returns {Promise<string[]|null>} */
export async function getBlacklistedUsers(guildId) {
  try {
    const doc = await getCollection(COLLECTIONS.BLACKLISTED_USERS).findOne({ guildId });
    return doc?.users ?? null;
  } catch (error) {
    logger.error('Error getting blacklisted users', error);
    return null;
  }
}

/** @returns {Promise<Object>} Map of guildId → string[] */
export async function getAllBlacklistedUsers() {
  try {
    const docs = await getCollection(COLLECTIONS.BLACKLISTED_USERS).find({}).toArray();
    const result = {};
    docs.forEach(doc => { result[doc.guildId] = doc.users; });
    return result;
  } catch (error) {
    logger.error('Error getting all blacklisted users', error);
    return {};
  }
}

// ============================================================================
// CHANNEL SETTINGS
// ============================================================================

/** @param {string} channelId @param {string} settingType @param {*} value */
export async function saveChannelSetting(channelId, settingType, value) {
  try {
    await getCollection(COLLECTIONS.CHANNEL_SETTINGS).updateOne(
      { channelId },
      { $set: { channelId, [settingType]: value, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving channel setting', error);
    throw error;
  }
}

/** @param {string} channelId @param {string} settingType @returns {Promise<*>} */
export async function getChannelSetting(channelId, settingType) {
  try {
    const doc = await getCollection(COLLECTIONS.CHANNEL_SETTINGS).findOne({ channelId });
    return doc?.[settingType] ?? null;
  } catch (error) {
    logger.error('Error getting channel setting', error);
    return null;
  }
}

/** @param {string} settingType @returns {Promise<Object>} Map of channelId → value */
export async function getAllChannelSettings(settingType) {
  try {
    const docs = await getCollection(COLLECTIONS.CHANNEL_SETTINGS).find({}).toArray();
    const result = {};
    docs.forEach(doc => {
      if (doc[settingType] !== undefined) result[doc.channelId] = doc[settingType];
    });
    return result;
  } catch (error) {
    logger.error('Error getting all channel settings', error);
    return {};
  }
}

// ============================================================================
// ACTIVE USERS IN CHANNELS
// ============================================================================

/** @param {Object} data */
export async function saveActiveUsersInChannels(data) {
  try {
    await getCollection(COLLECTIONS.ACTIVE_USERS).updateOne(
      { _id: 'active_users' },
      { $set: { data, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving active users', error);
    throw error;
  }
}

/** @returns {Promise<Object>} */
export async function getActiveUsersInChannels() {
  try {
    const doc = await getCollection(COLLECTIONS.ACTIVE_USERS).findOne({ _id: 'active_users' });
    return doc?.data ?? {};
  } catch (error) {
    logger.error('Error getting active users', error);
    return {};
  }
}

// ============================================================================
// USER RESPONSE PREFERENCES
// ============================================================================

/** @param {string} userId @param {string} preference */
export async function saveUserResponsePreference(userId, preference) {
  try {
    await getCollection(COLLECTIONS.USER_RESPONSE_PREF).updateOne(
      { userId },
      { $set: { userId, preference, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving user response preference', error);
    throw error;
  }
}

/** @param {string} userId @returns {Promise<string|null>} */
export async function getUserResponsePreference(userId) {
  try {
    const doc = await getCollection(COLLECTIONS.USER_RESPONSE_PREF).findOne({ userId });
    return doc?.preference ?? null;
  } catch (error) {
    logger.error('Error getting user response preference', error);
    return null;
  }
}

/** @returns {Promise<Object>} Map of userId → preference */
export async function getAllUserResponsePreferences() {
  try {
    const docs = await getCollection(COLLECTIONS.USER_RESPONSE_PREF).find({}).toArray();
    const result = {};
    docs.forEach(doc => { result[doc.userId] = doc.preference; });
    return result;
  } catch (error) {
    logger.error('Error getting all user response preferences', error);
    return {};
  }
}
