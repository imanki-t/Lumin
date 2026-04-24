/**
 * @fileoverview Memory system facade — single entry point for all memory operations.
 * Orchestrates RAG retrieval, history optimisation, context assembly, and admin surface.
 * @module memory/MemorySystem
 */

import * as db from '../database/index.js';
import { Logger } from '../core/Logger.js';
import { embeddingService } from './EmbeddingService.js';
import { memoryCache }      from './MemoryCache.js';
import { clusterEngine }    from './ClusterEngine.js';
import { memoryStore }      from './MemoryStore.js';
import { redisCache }       from './RedisCache.js';
import { formatDuration }   from '../modules/shared/messageFormatter.js';
import { state }            from '../managers/StateManager.js';
import {
  CACHE_ENABLED,
  MEMORY_RECENT_WINDOW    as RECENT_MESSAGE_WINDOW,
  MEMORY_MAX_RAG_RESULTS  as MAX_RAG_RESULTS,
  MEMORY_SCORE_THRESHOLD  as MIN_SIMILARITY_THRESHOLD,
  MEMORY_TIME_GAP_MS      as TIME_GAP_THRESHOLD_MS,
  MEMORY_MAX_INLINE_CTX   as MAX_INLINE_CONTEXT_SIZE
} from './config.js';

const logger = Logger.get('MemorySystem');

// Extract plain text from a history message entry. Supports `content` and `parts` shapes.
function extractTextFromMessage(message) {
  if (!message || (!message.content && !message.parts)) return '';
  const parts = message.content || message.parts;
  if (!Array.isArray(parts)) return '';
  return parts.filter(p => p?.text).map(p => p.text).join(' ').trim();
}

// ============================================================================
// MEMORY SYSTEM FACADE
// ============================================================================

class MemorySystem {

  // ==========================================================================
  // PUBLIC DELEGATION — surfaces MemoryStore / ClusterEngine APIs externally
  // ==========================================================================

  /**
   * Initialise Redis connection at startup.
   * Safe to call multiple times — no-ops if already connected.
   * @returns {Promise<void>}
   */
  async init() {
    // Redis cache is optional — controlled by CACHE_ENABLED in modules/config.js.
    // When disabled, the in-memory L1/L2 cache (MemoryCache) still works fine.
    if (CACHE_ENABLED) {
      await redisCache.connect();
    }
  }

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

  /**
   * Store a conversation chunk with its embedding for RAG retrieval.
   * Called by HistoryManager after every saved turn.
   * @see MemoryStore.storeMemoryWithEmbedding
   */
  storeMemoryWithEmbedding(historyId, messages, userId = null, guildId = null) {
    return memoryStore.storeMemoryWithEmbedding(historyId, messages, userId, guildId);
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

      // When cache is disabled, go straight to Atlas $vectorSearch
      if (!CACHE_ENABLED) {
        const queryEmbedding = await embeddingService.generateEmbedding(query, 'RETRIEVAL_QUERY');
        if (!queryEmbedding) return [];
        const results = await db.findSimilarMemories(historyId, queryEmbedding, MAX_RAG_RESULTS * 2);
        return (results || [])
          .filter(e => e.score >= MIN_SIMILARITY_THRESHOLD)
          .slice(0, MAX_RAG_RESULTS)
          .map(entry => `[Memory] ${extractTextFromMessage({ content: entry.messages[0]?.content })}`);
      }

      // Cache enabled: check L1/L2 first
      const exact = memoryCache.getCachedQueryResults(historyId, query, userId, guildId);
      if (exact) {
        return exact.map(entry =>
          `[Memory] ${extractTextFromMessage({ content: entry.messages[0]?.content })}`
        );
      }

      const queryEmbedding = await embeddingService.generateEmbedding(query, 'RETRIEVAL_QUERY');
      if (!queryEmbedding) return [];

      const semantic = memoryCache.getSemanticallyCachedResults(historyId, queryEmbedding, userId, guildId);
      if (semantic) {
        return semantic.map(entry =>
          `[Memory] ${extractTextFromMessage({ content: entry.messages[0]?.content })}`
        );
      }

      const results = await clusterEngine.clusterSearch(historyId, queryEmbedding, Date.now());
      if (!results?.length) return [];

      memoryCache.cacheQueryResults(historyId, query, results, userId, guildId, queryEmbedding);

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
   *
   * TWO CODE PATHS — controlled by CACHE_ENABLED in modules/config.js:
   *
   *   CACHE_ENABLED = false  →  _directVectorSearch()
   *     Skips ALL cache layers (L1/L2/L3) and the ClusterEngine entirely.
   *     Every call goes directly to MongoDB Atlas $vectorSearch.
   *     Zero local RAM used for embeddings — Atlas does all computation.
   *     Best for: budget deployments, 512 MB RAM, 10k users.
   *
   *   CACHE_ENABLED = true  →  full L1 → L2 → L3 → ClusterEngine pipeline
   *     L1: exact in-memory hit     (<0.1 ms, free)
   *     L2: semantic in-memory hit  (<1 ms, free)
   *     L3: Redis hit               (~1-2 ms, survives restarts)
   *     L4: ClusterEngine + Atlas   (full RAG, ~50-200 ms)
   *     Best for: dedicated servers with ≥2 GB RAM.
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

      // ── CACHE DISABLED: direct Atlas $vectorSearch, zero local RAM ───────────
      if (!CACHE_ENABLED) {
        return await this._directVectorSearch(
          historyId, currentQuery, recentMessageTimestamps, userId, guildId
        );
      }

      // ── L1: Exact in-memory hit (free, <0.1ms) ───────────────────────────────
      const exactCached = memoryCache.getCachedQueryResults(historyId, currentQuery, userId, guildId);
      if (exactCached) {
        const personalData = userId ? await memoryStore.getUserPersonalData(userId) : null;
        return { messages: exactCached, personalData };
      }

      const [queryEmbedding, personalData] = await Promise.all([
        embeddingService.generateEmbedding(currentQuery, 'RETRIEVAL_QUERY'),
        userId ? memoryStore.getUserPersonalData(userId) : Promise.resolve(null)
      ]);

      if (!queryEmbedding) return { messages: [], personalData };

      // ── L2: Semantic in-memory hit (free, <1ms) ──────────────────────────────
      const semanticCached = memoryCache.getSemanticallyCachedResults(historyId, queryEmbedding, userId, guildId);
      if (semanticCached) return { messages: semanticCached, personalData };

      // ── L3: Redis hit (~1-2ms, survives restarts) ─────────────────────────────
      const queryHash   = memoryCache.generateQueryHash(historyId, currentQuery, userId, guildId);
      const redisCached = await redisCache.get(historyId, queryHash);
      if (redisCached) {
        memoryCache.cacheQueryResults(historyId, currentQuery, redisCached, userId, guildId, queryEmbedding);
        return { messages: redisCached, personalData };
      }

      // ── L4: ClusterEngine + Atlas full RAG ───────────────────────────────────
      const cutoffTimestamp     = Math.max(...recentMessageTimestamps) - TIME_GAP_THRESHOLD_MS;
      const crossContextEnabled = userId
        ? (state.userSettings[userId]?.crossContextEnabled ?? false)
        : false;

      const searchPromises = [
        clusterEngine.clusterSearch(historyId, queryEmbedding, cutoffTimestamp)
      ];

      if (crossContextEnabled && userId) {
        // Track X (cross-context ON): entire user footprint — all servers + DMs.
        // Replaces Track 2 & 3 with a single broader query.
        searchPromises.push(
          db.findSimilarMemoriesByUser(userId, queryEmbedding, MAX_RAG_RESULTS, historyId)
            .then(results => (results || [])
              .filter(e => (e.timestamp || 0) < cutoffTimestamp && e.score >= MIN_SIMILARITY_THRESHOLD)
              .map(e => ({
                messages:  e.messages,
                score:     e.score * 0.80,
                source:    e.metadata?.guildId ? 'cross-server-context' : 'cross-dm-context',
                timestamp: e.timestamp
              }))
            ).catch(() => [])
        );
      } else {
        // Track 2 (default): in a DM — also search current server history for this user
        if (userId && guildId && historyId !== guildId) {
          searchPromises.push(
            db.findSimilarMemoriesWithFilter(guildId, queryEmbedding, 1, { userId })
              .then(results => (results || [])
                .filter(e => (e.timestamp || 0) < cutoffTimestamp && e.score >= MIN_SIMILARITY_THRESHOLD)
                .map(e => ({ messages: e.messages, score: e.score * 0.85, source: 'server-context', timestamp: e.timestamp }))
              ).catch(() => [])
          );
        }

        // Track 3 (default): in a server — also search this user's DM history
        if (guildId && historyId === guildId && userId) {
          searchPromises.push(
            clusterEngine.clusterSearch(userId, queryEmbedding, cutoffTimestamp)
              .then(results => (results || []).map(e => ({
                messages: e.messages.slice(-6), score: e.score * 0.75, source: 'user-context', timestamp: e.timestamp
              }))).catch(() => [])
          );
        }
      }

      const allResults = (await Promise.all(searchPromises)).flat();
      allResults.sort((a, b) => b.score - a.score);
      const topResults = allResults.slice(0, MAX_RAG_RESULTS);

      // Write-back to L1 + L3 (Redis is fire-and-forget)
      memoryCache.cacheQueryResults(historyId, currentQuery, topResults, userId, guildId, queryEmbedding);
      redisCache.set(historyId, queryHash, topResults);

      return { messages: topResults, personalData };

    } catch (error) {
      logger.error('Context retrieval failed', error);
      return { messages: [], personalData: null };
    }
  }

  /**
   * Direct MongoDB Atlas $vectorSearch — the CACHE_ENABLED=false fast path.
   *
   * All tracks fire as parallel Atlas aggregations.
   * No local embeddings held in RAM. No LRU. No ClusterEngine.
   *
   * Cross-context behaviour is controlled by the CROSS_CONTEXT_ENABLED runtime
   * flag (togglable live from the dashboard, no restart required):
   *
   *   OFF (default):
   *     Track 1 — current historyId (main conversation)
   *     Track 2 — DM→server bridge: if in a DM, also search current server history
   *     Track 3 — server→DM bridge: if in a server, also search user's DM history
   *
   *   ON:
   *     Track 1 — current historyId (main conversation)
   *     Track X — full user-wide search: every server + DMs, all at once.
   *               Replaces Track 2 & 3 with a single broader Atlas query.
   *
   * @private
   */
  async _directVectorSearch(historyId, currentQuery, recentMessageTimestamps, userId, guildId) {
    const cutoffTimestamp     = Math.max(...recentMessageTimestamps) - TIME_GAP_THRESHOLD_MS;
    const crossContextEnabled = userId
      ? (state.userSettings[userId]?.crossContextEnabled ?? false)
      : false;

    const [queryEmbedding, personalData] = await Promise.all([
      embeddingService.generateEmbedding(currentQuery, 'RETRIEVAL_QUERY'),
      userId ? memoryStore.getUserPersonalData(userId) : Promise.resolve(null)
    ]);

    if (!queryEmbedding) return { messages: [], personalData };

    const searchPromises = [
      // Track 1: current conversation history (always runs)
      db.findSimilarMemories(historyId, queryEmbedding, MAX_RAG_RESULTS * 2)
        .then(results => (results || [])
          .filter(e => (e.timestamp || 0) < cutoffTimestamp && e.score >= MIN_SIMILARITY_THRESHOLD)
          .map(e => ({ messages: e.messages, score: e.score, source: 'conversation-history', timestamp: e.timestamp }))
        ).catch(() => [])
    ];

    if (crossContextEnabled && userId) {
      // Track X (cross-context ON): search entire user footprint — all servers + DMs.
      // Replaces Track 2 & 3 with a single broader query.
      searchPromises.push(
        db.findSimilarMemoriesByUser(userId, queryEmbedding, MAX_RAG_RESULTS, historyId)
          .then(results => (results || [])
            .filter(e => (e.timestamp || 0) < cutoffTimestamp && e.score >= MIN_SIMILARITY_THRESHOLD)
            .map(e => ({
              messages:  e.messages,
              score:     e.score * 0.80,
              source:    e.metadata?.guildId ? 'cross-server-context' : 'cross-dm-context',
              timestamp: e.timestamp
            }))
          ).catch(() => [])
      );
    } else {
      // Track 2 (default): in a DM — also search the current server's history for this user
      if (userId && guildId && historyId !== guildId) {
        searchPromises.push(
          db.findSimilarMemoriesWithFilter(guildId, queryEmbedding, 1, { userId })
            .then(results => (results || [])
              .filter(e => (e.timestamp || 0) < cutoffTimestamp && e.score >= MIN_SIMILARITY_THRESHOLD)
              .map(e => ({ messages: e.messages, score: e.score * 0.85, source: 'server-context', timestamp: e.timestamp }))
            ).catch(() => [])
        );
      }

      // Track 3 (default): in a server — also search this user's DM history
      if (guildId && historyId === guildId && userId) {
        searchPromises.push(
          db.findSimilarMemories(userId, queryEmbedding, 2)
            .then(results => (results || [])
              .filter(e => (e.timestamp || 0) < cutoffTimestamp && e.score >= MIN_SIMILARITY_THRESHOLD)
              .map(e => ({ messages: e.messages.slice(-6), score: e.score * 0.75, source: 'user-context', timestamp: e.timestamp }))
            ).catch(() => [])
        );
      }
    }

    const allResults = (await Promise.all(searchPromises)).flat();
    allResults.sort((a, b) => b.score - a.score);
    return { messages: allResults.slice(0, MAX_RAG_RESULTS), personalData };
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

      // Flatten all history buckets into a single chronological array.
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

      if (!formattedContext) return formattedRecent;

      // If formattedRecent starts with 'user', prepend a model ack so the
      // context user-block and the first real user turn don't collide.
      const needsBridge = formattedRecent.length > 0 && formattedRecent[0].role === 'user';
      const bridge = needsBridge
        ? [{ role: 'model', parts: [{ text: '[Context noted]' }] }]
        : [];

      return [formattedContext, ...bridge, ...formattedRecent];

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
      'cross-server-context':  'From Another Server You Use',
      'cross-dm-context':      'From Your DMs With Me',
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

    return this.sanitizeHistory(formatted);
  }

  /**
   * Enforce strict user→model alternation required by the Gemini API.
   * Merges consecutive same-role entries, drops leading model turns,
   * and drops a trailing user turn (prevents double-user collision with
   * the live message that follows).
   *
   * @param {object[]} entries
   * @returns {object[]}
   */
  sanitizeHistory(entries) {
    if (!entries?.length) return [];

    // Merge consecutive same-role entries
    const merged = [];
    for (const entry of entries) {
      const last = merged[merged.length - 1];
      if (last && last.role === entry.role) {
        last.parts.push(...entry.parts);
      } else {
        merged.push({ role: entry.role, parts: [...entry.parts] });
      }
    }

    // History must start with 'user'
    while (merged.length > 0 && merged[0].role !== 'user') merged.shift();

    // Drop unpaired trailing 'user' — live message supplies the next user turn
    if (merged.length > 0 && merged[merged.length - 1].role === 'user') merged.pop();

    return merged;
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
        mode:                 CACHE_ENABLED ? 'full (L1+L2+L3+ClusterEngine)' : 'disabled (direct Atlas $vectorSearch)',
        queryCacheTTL:        CACHE_ENABLED ? '2m' : 'n/a',
        clusterCacheTTL:      CACHE_ENABLED ? '15m' : 'n/a',
        personalDataCacheTTL: '5m',
        timeGapThreshold:     '30s',
        backgroundClustering: CACHE_ENABLED ? 'enabled' : 'disabled',
        redisCache:           CACHE_ENABLED ? (redisCache.isAvailable ? 'connected' : 'disconnected') : 'disabled'
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
