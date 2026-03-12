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

/**
 * Fetch ONLY _id, embedding, and timestamp for a history — no messages/text/metadata.
 * Used by ClusterEngine as a lean first-pass load for clustering and similarity ranking.
 * Cuts network payload by ~10-20× vs getMemoryEntries for large histories.
 *
 * @param {string} historyId
 * @param {number} [limit=1000]
 * @returns {Promise<Array<{ _id: import('mongodb').ObjectId, embedding: number[], timestamp: number }>>}
 */
export async function getMemoryEmbeddings(historyId, limit = 1000) {
  try {
    return await getCollection(COLLECTIONS.MEMORY_ENTRIES)
      .find(
        { 'metadata.historyId': historyId },
        { projection: { _id: 1, embedding: 1, timestamp: 1 } }
      )
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  } catch (error) {
    logger.error('Error getting memory embeddings', error);
    return [];
  }
}

/**
 * Fetch full memory documents for a specific set of IDs.
 * Used by ClusterEngine after cluster filtering to hydrate only the winning
 * entries (typically MAX_RAG_RESULTS = 3) rather than the entire 1000-doc set.
 *
 * @param {import('mongodb').ObjectId[]} ids
 * @returns {Promise<Array>}
 */
export async function getMemoryEntriesByIds(ids) {
  if (!ids?.length) return [];
  try {
    return await getCollection(COLLECTIONS.MEMORY_ENTRIES)
      .find({ _id: { $in: ids } })
      .toArray();
  } catch (error) {
    logger.error('Error getting memory entries by ids', error);
    return [];
  }
}
