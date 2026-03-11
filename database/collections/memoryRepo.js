/**
 * @fileoverview Memory entries repository for the RAG memory system.
 *               Stores embedding + text pairs keyed by historyId.
 * @module database/collections/memoryRepo
 */

import { Logger }                    from '../../core/Logger.js';
import { COLLECTIONS, getCollection } from '../connection.js';

const logger = Logger.get('MemoryRepo');

/**
 * Insert a new memory entry (with embedding vector).
 * @param {string} historyId
 * @param {Object} entry - Must contain `embedding`, `text`, `messages`, and `metadata`
 */
export async function saveMemoryEntry(historyId, entry) {
  try {
    await getCollection(COLLECTIONS.MEMORY_ENTRIES).insertOne({
      ...entry,
      metadata:  entry.metadata || { historyId },
      createdAt: new Date()
    });
  } catch (error) {
    logger.error('Error saving memory entry', error);
    throw error;
  }
}

/**
 * Get recent memory entries for a history (fallback / debug use).
 * @param {string} historyId
 * @param {number} [limit=50]
 * @returns {Promise<Array>}
 */
export async function getMemoryEntries(historyId, limit = 50) {
  try {
    return await getCollection(COLLECTIONS.MEMORY_ENTRIES)
      .find({ 'metadata.historyId': historyId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  } catch (error) {
    logger.error('Error getting memory entries', error);
    return [];
  }
}

/**
 * Delete memory entries older than the given timestamp cutoff.
 * @param {number} cutoffTimestamp - Unix ms timestamp
 * @returns {Promise<number>} Number of deleted entries
 */
export async function deleteOldMemoryEntries(cutoffTimestamp) {
  try {
    const result = await getCollection(COLLECTIONS.MEMORY_ENTRIES)
      .deleteMany({ timestamp: { $lt: cutoffTimestamp } });
    return result.deletedCount;
  } catch (error) {
    logger.error('Error deleting old memory entries', error);
    return 0;
  }
}
