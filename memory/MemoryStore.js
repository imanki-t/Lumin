/**
 * @fileoverview Memory storage, incremental background indexing, and
 *               user personal-data management with TTL caching.
 * @module memory/MemoryStore
 */

import * as db from '../database/index.js';
import { Logger } from '../core/Logger.js';
import { embeddingService } from './EmbeddingService.js';
import { clusterEngine } from './ClusterEngine.js';
import {
  MEMORY_RECENT_WINDOW       as RECENT_MESSAGE_WINDOW,
  MEMORY_CHUNK_SIZE           as CHUNK_SIZE,
  MEMORY_CHUNK_OVERLAP        as CHUNK_OVERLAP,
  MEMORY_INDEX_BATCH_SIZE     as PARALLEL_INDEX_BATCH_SIZE,
  MEMORY_PERSONAL_CACHE_TTL_MS as PERSONAL_DATA_CACHE_TTL_MS
} from './config.js';

const logger = Logger.get('MemoryStore');

// Extract plain text from a history message entry. Supports `content` and `parts` shapes.
function extractTextFromMessage(message) {
  if (!message || (!message.content && !message.parts)) return '';
  const parts = message.content || message.parts;
  if (!Array.isArray(parts)) return '';
  return parts.filter(p => p?.text).map(p => p.text).join(' ').trim();
}

// ============================================================================
// MEMORY STORE
// ============================================================================

class MemoryStore {
  constructor() {
    /** @type {Map<string, number>} historyId → count of already-indexed messages */
    this.lastIndexedCount  = new Map();
    /** @type {Map<string, object>} userId → { text, embedding, timestamp } */
    this.personalDataCache = new Map();

    // ── Render free tier: nudge GC every 10 min to reclaim old buffers ────────
    // --expose-gc is set in package.json start script.
    setInterval(() => {
      if (typeof global.gc === 'function') global.gc();
      // Cap personalDataCache to prevent unbounded growth
      if (this.personalDataCache.size > 50) this.personalDataCache.clear();
    }, 10 * 60 * 1_000).unref(); // .unref() = won't block process exit
  }

  // ==========================================================================
  // MEMORY STORAGE
  // ==========================================================================

  /**
   * Store a conversation chunk with its embedding in the DB for RAG retrieval.
   * No-op if the chunk is too short to be meaningful.
   *
   * @param {string}      historyId
   * @param {object[]}    messages
   * @param {string|null} [userId]
   * @param {string|null} [guildId]
   * @returns {Promise<void>}
   */
  async storeMemoryWithEmbedding(historyId, messages, userId = null, guildId = null) {
    try {
      const conversationText = messages
        .map(extractTextFromMessage)
        .filter(t => t.length > 0)
        .join(' ');

      if (conversationText.length < 10) return;

      const embedding = await embeddingService.generateEmbedding(conversationText, 'RETRIEVAL_DOCUMENT');
      if (!embedding) return;

      await db.saveMemoryEntry(historyId, {
        messages,
        embedding,
        text:      conversationText.slice(0, 1000),
        metadata:  {
          historyId,
          userId:  userId  || null,
          guildId: guildId || null,
          timestamp: Date.now()
        },
        timestamp: Date.now()
      });

      // Bust the ClusterEngine embeddings cache so the next query sees this entry
      clusterEngine.invalidateEmbeddingsCache(historyId);
    } catch (error) {
      logger.error('Memory storage failed', error);
    }
  }

  // ==========================================================================
  // BACKGROUND INDEXING
  // ==========================================================================

  /**
   * Incrementally index old messages into the vector store.
   * Called fire-and-forget from MemorySystem.getOptimizedHistory — never awaited.
   * @param {string}      historyId
   * @param {object}      allHistory  - { [messagesId]: message[] }
   * @param {string|null} [userId]
   * @param {string|null} [guildId]
   * @returns {Promise<void>}
   */
  async checkAndIndexMessages(historyId, allHistory, userId = null, guildId = null) {
    try {
      const historyArray = [];
      for (const key of Object.keys(allHistory)) {
        historyArray.push(...(allHistory[key] || []));
      }

      const currentCount = historyArray.length;
      const lastIndexed  = this.lastIndexedCount.get(historyId) || 0;

      // Only index when we have enough new messages for a fresh chunk
      if (currentCount - lastIndexed < (CHUNK_SIZE - CHUNK_OVERLAP)) return;

      const oldMessages  = historyArray.slice(0, -RECENT_MESSAGE_WINDOW);
      if (oldMessages.length <= lastIndexed) return;

      const batches  = [];
      const startIdx = Math.max(0, lastIndexed - CHUNK_OVERLAP);

      for (let i = startIdx; i < oldMessages.length; i += (CHUNK_SIZE - CHUNK_OVERLAP)) {
        const chunk = oldMessages.slice(i, i + CHUNK_SIZE);
        if (chunk.length >= 3) batches.push(chunk);
      }

      // Process in controlled parallel groups to avoid flooding the embedding API
      for (let i = 0; i < batches.length; i += PARALLEL_INDEX_BATCH_SIZE) {
        const group = batches.slice(i, i + PARALLEL_INDEX_BATCH_SIZE);
        await Promise.all(
          group.map(batch =>
            this.storeMemoryWithEmbedding(historyId, batch, userId, guildId)
              .catch(err => logger.error('Background indexing error', err))
          )
        );
      }

      this.lastIndexedCount.set(historyId, oldMessages.length);
    } catch (error) {
      logger.error('Auto-indexing check failed', error);
    }
  }

  // ==========================================================================
  // PERSONAL DATA MANAGEMENT
  // ==========================================================================

  /** Invalidate cached personal data for a user (call after mutations). */
  invalidatePersonalDataCache(userId) {
    this.personalDataCache.delete(userId);
  }

  /**
   * Add a fact to a user's personal memory store.
   *
   * @param {string} userId
   * @param {string} fact
   * @returns {Promise<boolean>}
   */
  async addPersonalData(userId, fact) {
    try {
      await db.saveUserFact(userId, fact);
      this.invalidatePersonalDataCache(userId);
      return true;
    } catch (error) {
      logger.error('Failed to add personal data', error);
      return false;
    }
  }

  /**
   * Remove a fact from a user's personal memory by keyword match.
   *
   * @param {string} userId
   * @param {string} factKeyword
   * @returns {Promise<boolean>} true if at least one fact was deleted
   */
  async removePersonalData(userId, factKeyword) {
    try {
      const deletedCount = await db.deleteUserFact(userId, factKeyword);
      this.invalidatePersonalDataCache(userId);
      return deletedCount > 0;
    } catch (error) {
      logger.error('Failed to remove personal data', error);
      return false;
    }
  }

  /**
   * Retrieve all personal data for a user as a single text blob, with TTL caching.
   * All DB sources are fetched in parallel.
   *
   * @param {string} userId
   * @returns {Promise<{ text: string, embedding: number[]|null, timestamp: number }|null>}
   */
  async getUserPersonalData(userId) {
    const cached = this.personalDataCache.get(userId);
    if (cached && (Date.now() - cached.timestamp) < PERSONAL_DATA_CACHE_TTL_MS) return cached;

    try {
      // All DB lookups in parallel
      const [
        timezone, birthday, reminders,
        complimentCount, dailyQuote, userFacts
      ] = await Promise.all([
        db.getUserTimezone(userId),
        db.getBirthday(userId),
        db.getUserReminders(userId),
        db.getComplimentCount(userId),
        db.getUserDailyQuote(userId),
        db.getUserFacts(userId)
      ]);

      const facts = [];

      if (timezone) {
        facts.push(`User's timezone: ${timezone}`);
      }

      if (birthday) {
        const monthNames = [
          'January','February','March','April','May','June',
          'July','August','September','October','November','December'
        ];
        facts.push(`User's birthday: ${monthNames[birthday.month]} ${birthday.day}`);
      }

      if (reminders?.length > 0) {
        const active = reminders.filter(r => r.active).slice(0, 3);
        if (active.length > 0) {
          facts.push(`User has ${reminders.length} active reminders`);
          active.forEach(r => facts.push(`Reminder: "${r.message}"`));
        }
      }

      if (complimentCount > 0) {
        facts.push(`User has received ${complimentCount} compliments`);
      }

      if (dailyQuote?.active) {
        facts.push(`User receives daily ${dailyQuote.category || 'motivational'} quotes`);
      }

      if (userFacts?.length > 0) {
        facts.push(`\n[User's Personal Context/Memories]:`);
        userFacts.forEach(f => facts.push(`- ${f}`));
      }

      if (facts.length === 0) return null;

      const personalContext = facts.join('\n');
      const embedding = await embeddingService.generateEmbedding(personalContext, 'RETRIEVAL_DOCUMENT');

      const result = { text: personalContext, embedding, timestamp: Date.now() };
      this.personalDataCache.set(userId, result);
      return result;
    } catch (error) {
      logger.error('Failed to fetch user personal data', error);
      return null;
    }
  }

  // ==========================================================================
  // DEBUG / ADMIN
  // ==========================================================================

  /**
   * Force full synchronous indexing of all messages for a history.
   * Admin/debug use only — can be slow for large histories.
   * @param {string}      historyId
   * @param {string|null} [userId]
   * @param {string|null} [guildId]
   * @returns {Promise<object>}
   */
  async forceIndexNow(historyId, userId = null, guildId = null) {
    try {
      const allHistory = await db.getChatHistory(historyId);
      if (!allHistory) return { success: false, message: 'No history found' };

      const historyArray = [];
      for (const key of Object.keys(allHistory)) {
        historyArray.push(...(allHistory[key] || []));
      }

      const oldMessages = historyArray.slice(0, -RECENT_MESSAGE_WINDOW);
      if (oldMessages.length === 0) return { success: false, message: 'No old messages to index' };

      const batches = [];
      for (let i = 0; i < oldMessages.length; i += (CHUNK_SIZE - CHUNK_OVERLAP)) {
        const chunk = oldMessages.slice(i, i + CHUNK_SIZE);
        if (chunk.length >= 3) batches.push(chunk);
      }

      logger.debug(`Force-indexing ${oldMessages.length} messages in ${batches.length} chunks (parallel)`);

      const parallelBatches = [];
      for (let i = 0; i < batches.length; i += PARALLEL_INDEX_BATCH_SIZE) {
        parallelBatches.push(batches.slice(i, i + PARALLEL_INDEX_BATCH_SIZE));
      }

      for (const group of parallelBatches) {
        await Promise.all(
          group.map(batch => this.storeMemoryWithEmbedding(historyId, batch, userId, guildId))
        );
      }

      this.lastIndexedCount.set(historyId, oldMessages.length);

      return {
        success:       true,
        message:       `Indexed ${oldMessages.length} messages in ${batches.length} overlapping chunks (parallel)`,
        batchCount:    batches.length,
        messageCount:  oldMessages.length,
        parallelGroups: parallelBatches.length
      };
    } catch (error) {
      logger.error('Force indexing failed', error);
      return { success: false, message: error.message };
    }
  }

  /** Clear all store caches. */
  clearCache() {
    this.personalDataCache.clear();
    this.lastIndexedCount.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const memoryStore = new MemoryStore();
