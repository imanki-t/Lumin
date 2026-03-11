/**
 * @fileoverview Memory system facade — the single entry point for all memory
 *               operations. Orchestrates RAG retrieval, history optimisation,
 *               context assembly, and exposes the debug/admin surface.
 *
 * REMOVED: `generateSummary` — the method called `genAI.chats.create()` which
 * does not exist in the `@google/genai` SDK (v0.7+). The old-messages fallback
 * (last-8 slice of older messages) is used instead, preserving context without
 * an extra API call and without the broken SDK path.
 *
 * @module memory/MemorySystem
 */

import * as db from '../database/index.js';
import { Logger } from '../core/Logger.js';
import { embeddingService } from './EmbeddingService.js';
import { memoryCache }      from './MemoryCache.js';
import { clusterEngine }    from './ClusterEngine.js';
import { memoryStore }      from './MemoryStore.js';

const logger = Logger.get('MemorySystem');

// ============================================================================
// CONSTANTS
// ============================================================================

const RECENT_MESSAGE_WINDOW    = 10;
const MAX_RAG_RESULTS          = 3;
const MIN_SIMILARITY_THRESHOLD = 0.65;
/** 30-second gap triggers a TIME ELAPSED marker in formatted history */
const TIME_GAP_THRESHOLD_MS    = 30 * 1000;
/** Context block exceeding this is dropped (too big for Gemini inline) */
const MAX_INLINE_CONTEXT_SIZE  = 1500;

// ============================================================================
// MODULE-LEVEL UTILITIES
// ============================================================================

/**
 * Extract plain text from a history message entry.
 * Supports both `content` and `parts` field shapes.
 *
 * @param {object} message
 * @returns {string}
 */
function extractTextFromMessage(message) {
  if (!message || (!message.content && !message.parts)) return '';
  const parts = message.content || message.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(p => p?.text)
    .map(p => p.text)
    .join(' ')
    .trim();
}

/**
 * Format a millisecond duration into a human-readable string.
 *
 * @param {number} ms
 * @returns {string} e.g. "3 hours", "12 minutes"
 */
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d} day${d > 1 ? 's' : ''}`;
  if (h > 0) return `${h} hour${h > 1 ? 's' : ''}`;
  if (m > 0) return `${m} minute${m > 1 ? 's' : ''}`;
  return `${s} second${s > 1 ? 's' : ''}`;
}

// ============================================================================
// MEMORY SYSTEM FACADE
// ============================================================================

class MemorySystem {

  // ==========================================================================
  // PUBLIC DELEGATION — surfaces MemoryStore / ClusterEngine APIs externally
  // ==========================================================================

  /**
   * Add a fact to a user's personal memory.
   * @see MemoryStore.addPersonalData
   */
  addPersonalData(userId, fact) {
    return memoryStore.addPersonalData(userId, fact);
  }

  /**
   * Remove a fact from a user's personal memory.
   * @see MemoryStore.removePersonalData
   */
  removePersonalData(userId, factKeyword) {
    return memoryStore.removePersonalData(userId, factKeyword);
  }

  /**
   * Retrieve user personal data context object.
   * @see MemoryStore.getUserPersonalData
   */
  getUserPersonalData(userId) {
    return memoryStore.getUserPersonalData(userId);
  }

  /**
   * Invalidate cached personal data for a user.
   * @see MemoryStore.invalidatePersonalDataCache
   */
  invalidatePersonalDataCache(userId) {
    return memoryStore.invalidatePersonalDataCache(userId);
  }

  /**
   * Force a cluster rebuild for a history (invalidates query cache first).
   * @see ClusterEngine.forceRebuildClusters
   */
  forceRebuildClusters(historyId) {
    memoryCache.invalidateQueryCache(historyId);
    return clusterEngine.forceRebuildClusters(historyId);
  }

  /**
   * Force full synchronous indexing for a history.
   * @see MemoryStore.forceIndexNow
   */
  forceIndexNow(historyId, userId = null, guildId = null) {
    memoryCache.invalidateQueryCache(historyId);
    return memoryStore.forceIndexNow(historyId, userId, guildId);
  }

  // ==========================================================================
  // MEMORY SEARCH
  // ==========================================================================

  /**
   * Simple text-based memory search — used by function tools to answer
   * "do you remember X?" style queries.
   *
   * @param {string}      userId
   * @param {string|null} guildId
   * @param {string}      query
   * @returns {Promise<string[]>}
   */
  async searchMemory(userId, guildId, query) {
    try {
      const historyId = guildId || userId;

      // Check query cache first
      const cached = memoryCache.getCachedQueryResults(historyId, query, userId, guildId);
      if (cached) {
        return cached.map(entry =>
          `[Memory] ${extractTextFromMessage({ content: entry.messages[0]?.content })}`
        );
      }

      const queryEmbedding = await embeddingService.generateEmbedding(query, 'RETRIEVAL_QUERY');
      if (!queryEmbedding) return [];

      const results = await clusterEngine.clusterSearch(historyId, queryEmbedding, Date.now());
      if (!results?.length) return [];

      memoryCache.cacheQueryResults(historyId, query, results, userId, guildId);

      return results.map(entry =>
        `[Memory] ${extractTextFromMessage({ content: entry.messages[0]?.content })}`
      );
    } catch (error) {
      logger.error('Memory search failed', error);
      return [];
    }
  }

  // ==========================================================================
  // RAG CONTEXT RETRIEVAL
  // ==========================================================================

  /**
   * Retrieve relevant historical context for the current query via RAG.
   * Runs three parallel search tracks when applicable:
   *   1. Main historyId cluster search
   *   2. Cross-RAG: server memories filtered by user (if DM in server)
   *   3. Cross-RAG: user DM memories (if server query)
   *
   * @param {string}      historyId
   * @param {string}      currentQuery
   * @param {number[]}    recentMessageTimestamps
   * @param {string|null} [userId]
   * @param {string|null} [guildId]
   * @returns {Promise<{ messages: object[], personalData: object|null }>}
   */
  async getRelevantContext(historyId, currentQuery, recentMessageTimestamps, userId = null, guildId = null) {
    try {
      if (!currentQuery?.trim()) return { messages: [], personalData: null };

      // Return cached results if available (personal data still fetched fresh)
      const cached = memoryCache.getCachedQueryResults(historyId, currentQuery, userId, guildId);
      if (cached) {
        const personalData = userId ? await memoryStore.getUserPersonalData(userId) : null;
        return { messages: cached, personalData };
      }

      // Fetch embedding + personal data in parallel
      const [queryEmbedding, personalData] = await Promise.all([
        embeddingService.generateEmbedding(currentQuery, 'RETRIEVAL_QUERY'),
        userId ? memoryStore.getUserPersonalData(userId) : Promise.resolve(null)
      ]);

      if (!queryEmbedding) return { messages: [], personalData };

      const cutoffTimestamp = Math.max(...recentMessageTimestamps) - TIME_GAP_THRESHOLD_MS;

      // Build parallel search promise array
      const searchPromises = [
        // Track 1: Main history search (always)
        clusterEngine.clusterSearch(historyId, queryEmbedding, cutoffTimestamp)
      ];

      // Track 2: Server memories filtered by this specific user
      if (userId && guildId && historyId !== guildId) {
        searchPromises.push(
          db.findSimilarMemoriesWithFilter(guildId, queryEmbedding, 1, { userId })
            .then(results => (results || [])
              .filter(e =>
                (e.timestamp || 0) < cutoffTimestamp &&
                e.score >= MIN_SIMILARITY_THRESHOLD
              )
              .map(e => ({
                messages:  e.messages,
                score:     e.score * 0.85, // slightly downweight cross-context
                source:    'server-context',
                timestamp: e.timestamp
              }))
            )
            .catch(() => [])
        );
      }

      // Track 3: User DM memories for server queries
      if (guildId && historyId === guildId && userId) {
        searchPromises.push(
          clusterEngine.clusterSearch(userId, queryEmbedding, cutoffTimestamp)
            .then(results => (results || []).map(e => ({
              messages:  e.messages.slice(-6), // trim to avoid context bloat
              score:     e.score * 0.75,
              source:    'user-context',
              timestamp: e.timestamp
            })))
            .catch(() => [])
        );
      }

      const allResults = (await Promise.all(searchPromises)).flat();
      allResults.sort((a, b) => b.score - a.score);
      const topResults = allResults.slice(0, MAX_RAG_RESULTS);

      memoryCache.cacheQueryResults(historyId, currentQuery, topResults, userId, guildId);

      return { messages: topResults, personalData };
    } catch (error) {
      logger.error('Context retrieval failed', error);
      return { messages: [], personalData: null };
    }
  }

  // ==========================================================================
  // MAIN ENTRY POINT
  // ==========================================================================

  /**
   * Get the fully optimised conversation history for the Gemini API.
   *
   * Pipeline:
   *   1. Fetch + sort full history from DB
   *   2. Fire-and-forget background indexing
   *   3. Retrieve RAG context + personal data in parallel
   *   4. Assemble context sections (old-message sample, RAG hits, personal data)
   *   5. Return [contextMessage?, ...recentMessages] as Gemini contents array
   *
   * NOTE: Summary generation has been removed. The original `generateSummary`
   * used `genAI.chats.create()` which does not exist in `@google/genai` v0.7+.
   * The last-8-messages slice of old messages is used instead.
   *
   * BUG FIX (original): `for...in` with `hasOwnProperty` replaced with
   * `Object.keys()` throughout.
   *
   * @param {string}      historyId
   * @param {string}      currentQuery
   * @param {string}      model         - passed for API compat; not used internally
   * @param {string|null} [userId]
   * @param {string|null} [guildId]
   * @returns {Promise<object[]>}       - Gemini `contents` array
   */
  async getOptimizedHistory(historyId, currentQuery, model, userId = null, guildId = null) {
    try {
      const allHistory = await db.getChatHistory(historyId);
      if (!allHistory) return [];

      // BUG FIX: Object.keys() instead of for...in + hasOwnProperty
      const historyArray = [];
      for (const key of Object.keys(allHistory)) {
        historyArray.push(...(allHistory[key] || []));
      }

      if (historyArray.length === 0) return [];

      historyArray.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      const recentMessages   = historyArray.slice(-RECENT_MESSAGE_WINDOW);
      const oldMessages      = historyArray.slice(0, -RECENT_MESSAGE_WINDOW);
      const recentTimestamps = recentMessages.map(m => m.timestamp || Date.now());

      // Fire-and-forget — don't block response on indexing
      memoryStore.checkAndIndexMessages(historyId, allHistory, userId, guildId)
        .catch(() => {});

      // Short history: just format and return directly
      if (historyArray.length <= RECENT_MESSAGE_WINDOW) {
        return this.formatHistoryForAPI(recentMessages);
      }

      // Fetch RAG context (no summary — see JSDoc above)
      const ragResults = await this.getRelevantContext(
        historyId, currentQuery, recentTimestamps, userId, guildId
      );
      const { messages: relevantMemories, personalData } = ragResults;

      const contextSections = [];

      // Old-message sample (last 8 of the older portion)
      if (oldMessages.length > 0) {
        const sampledOld = oldMessages.slice(-8);
        contextSections.push({
          type:      'previous-conversation',
          content:   sampledOld
            .map(msg => `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${extractTextFromMessage(msg)}`)
            .join('\n'),
          timestamp: sampledOld[sampledOld.length - 1]?.timestamp || 0
        });
      }

      // RAG hits
      for (const memory of relevantMemories) {
        contextSections.push({
          type:      memory.source,
          content:   memory.messages
            .map(msg => `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${extractTextFromMessage(msg)}`)
            .join('\n'),
          score:     memory.score,
          timestamp: memory.timestamp,
          clusterId: memory.clusterId
        });
      }

      // Personal data (only if semantically relevant to this query)
      if (personalData?.embedding) {
        const queryEmbedding = await embeddingService.generateEmbedding(currentQuery, 'RETRIEVAL_QUERY');
        if (queryEmbedding) {
          const sim = embeddingService.cosineSimilarity(queryEmbedding, personalData.embedding);
          if (sim >= 0.3) {
            contextSections.push({
              type:      'personal-data',
              content:   personalData.text,
              score:     sim,
              timestamp: Date.now()
            });
          }
        }
      }

      const formattedContext = this.buildContextMessage(contextSections);
      const formattedRecent  = this.formatHistoryForAPI(recentMessages);

      return formattedContext
        ? [formattedContext, ...formattedRecent]
        : formattedRecent;

    } catch (error) {
      logger.error('History optimization failed', error);
      return [];
    }
  }

  // ==========================================================================
  // FORMATTING UTILITIES
  // ==========================================================================

  /**
   * Build a single Gemini `contents` entry from context sections.
   * Returns null if the assembled context exceeds MAX_INLINE_CONTEXT_SIZE.
   *
   * @param {Array<{ type: string, content: string, score?: number, clusterId?: number }>} sections
   * @returns {{ role: string, parts: object[] }|null}
   */
  buildContextMessage(sections) {
    if (sections.length === 0) return null;

    let text = '[HISTORICAL CONTEXT - This is past conversation, not the current message]\n\n';

    for (const section of sections) {
      const label       = this.getContextLabel(section.type);
      const scoreText   = section.score     !== undefined ? ` (Relevance: ${section.score.toFixed(2)})` : '';
      const clusterText = section.clusterId !== undefined ? ` [Cluster ${section.clusterId}]` : '';
      text += `[${label}${scoreText}${clusterText}]\n${section.content}\n\n`;
    }

    if (text.length > MAX_INLINE_CONTEXT_SIZE) return null;

    return { role: 'user', parts: [{ text: text.trim() }] };
  }

  /**
   * Human-readable label for a context section type.
   *
   * NOTE: 'summary' label removed — generateSummary has been removed entirely.
   *
   * @param {string} type
   * @returns {string}
   */
  getContextLabel(type) {
    return {
      'previous-conversation': 'Recent Previous Messages',
      'conversation-history':  'Relevant Past Conversation',
      'server-context':        'Related Server Discussion',
      'user-context':          'Your Previous Conversation',
      'personal-data':         'Your Personal Information'
    }[type] || 'Context';
  }

  /**
   * Format raw history entries into the Gemini API `contents` format.
   * Injects TIME ELAPSED markers where message gaps exceed TIME_GAP_THRESHOLD_MS.
   *
   * @param {object[]} messages
   * @returns {object[]}
   */
  formatHistoryForAPI(messages) {
    if (!messages?.length) return [];

    const formatted      = [];
    let   prevTimestamp  = null;

    for (const entry of messages) {
      const apiEntry = {
        role:  entry.role === 'assistant' ? 'model' : entry.role,
        parts: []
      };

      // Time gap marker
      if (prevTimestamp && entry.timestamp) {
        const diff = entry.timestamp - prevTimestamp;
        if (diff > TIME_GAP_THRESHOLD_MS) {
          apiEntry.parts.push({
            text: `[TIME ELAPSED: ${formatDuration(diff)} since previous message]\n`
          });
        }
      }
      prevTimestamp = entry.timestamp;

      let userInfoAdded = false;
      for (const part of (entry.content || entry.parts || [])) {
        if (part.text !== undefined && part.text !== '') {
          let text = part.text;
          // Prefix first user text part with display name
          if (!userInfoAdded && entry.role === 'user' && entry.username && entry.displayName) {
            text = `[${entry.displayName} (@${entry.username})]: ${text}`;
            userInfoAdded = true;
          }
          apiEntry.parts.push({ text });
        } else if (part.fileUri) {
          apiEntry.parts.push({
            text: `[Previous ${part.mimeType || 'media'} attachment - not available]`
          });
        } else if (part.inlineData) {
          apiEntry.parts.push({ text: '[Previous inline image]' });
        }
      }

      if (apiEntry.parts.length > 0) formatted.push(apiEntry);
    }

    return formatted;
  }

  // ==========================================================================
  // STATUS & DEBUG
  // ==========================================================================

  /**
   * Return serialisable status across all memory subsystems.
   * Called by the `/status` admin command.
   *
   * @returns {object}
   */
  getQueueStatus() {
    return {
      embeddingCacheSize:           embeddingService.embeddingCache.size,
      trackedHistories:             memoryStore.lastIndexedCount.size,
      personalDataCacheSize:        memoryStore.personalDataCache.size,
      queryCacheSize:               memoryCache.queryCache.size,
      clusteredHistories:           clusterEngine.clusterCache.size,
      backgroundClusteringActive:   Array.from(clusterEngine.clusteringInProgress.values())
                                        .filter(Boolean).length,
      clusterInfo:                  clusterEngine.getStatus(),
      parallelConfig: {
        maxConcurrentEmbeddings: 5,
        maxConcurrentDbOps:      10,
        parallelIndexBatchSize:  3
      },
      cacheConfig: {
        queryCacheTTL:       '2m',
        clusterCacheTTL:     '10m',
        personalDataCacheTTL: '5m',
        timeGapThreshold:    '30s',
        backgroundClustering: 'enabled'
      },
      entries: Array.from(memoryStore.lastIndexedCount.entries()).map(([id, count]) => ({
        historyId:               id,
        lastIndexedMessageCount: count
      }))
    };
  }

  /**
   * Clear all caches across every memory subsystem.
   * Admin/debug only.
   *
   * @returns {{ success: boolean, message: string }}
   */
  clearAllCaches() {
    embeddingService.clearCache();
    memoryCache.clearCache();
    clusterEngine.clearCache();
    memoryStore.clearCache();
    return { success: true, message: 'All caches cleared' };
  }
}

// ============================================================================
// EXPORT SINGLETON — preserves the same export shape as the original
// ============================================================================

export const memorySystem = new MemorySystem();
