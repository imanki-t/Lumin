/**
 * @fileoverview Chat history repository — save, get, list, and delete
 *               conversation histories keyed by user/guild/channel ID.
 * @module database/collections/historyRepo
 */

import { Logger }                    from '../../core/Logger.js';
import { COLLECTIONS, getCollection } from '../connection.js';

const logger = Logger.get('HistoryRepo');

/**
 * Persist a chat history object.
 * @param {string} id      - user / guild / channel ID
 * @param {Object} history - serialisable history object
 */
export async function saveChatHistory(id, history) {
  try {
    await getCollection(COLLECTIONS.CHAT_HISTORIES).updateOne(
      { id },
      { $set: { id, history, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    logger.error('Error saving chat history', error);
    throw error;
  }
}

/**
 * Retrieve a chat history object.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getChatHistory(id) {
  try {
    const doc = await getCollection(COLLECTIONS.CHAT_HISTORIES).findOne({ id });
    return doc?.history ?? null;
  } catch (error) {
    logger.error('Error getting chat history', error);
    return null;
  }
}

/**
 * Load all chat histories (used during bot initialization).
 * @returns {Promise<Object>} Map of id → history
 */
export async function getAllChatHistories() {
  try {
    const docs = await getCollection(COLLECTIONS.CHAT_HISTORIES).find({}).toArray();
    const result = {};
    docs.forEach(doc => { result[doc.id] = doc.history; });
    return result;
  } catch (error) {
    logger.error('Error getting all chat histories', error);
    return {};
  }
}

/**
 * Delete a chat history entry.
 * @param {string} id
 */
export async function deleteChatHistory(id) {
  try {
    await getCollection(COLLECTIONS.CHAT_HISTORIES).deleteOne({ id });
  } catch (error) {
    logger.error('Error deleting chat history', error);
    throw error;
  }
}
