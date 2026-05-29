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
import { extractTextFromMessage } from './memoryUtils.js';
import { formatDuration }   from '../modules/shared/messageFormatter.js';
import { state }            from '../managers/StateManager.js';
import {
  CACHE_ENABLED,
  ENABLE_RAG,
  MEMORY_RECENT_WINDOW    as RECENT_MESSAGE_WINDOW,
  MEMORY_MAX_RAG_RESULTS  as MAX_RAG_RESULTS,
  MEMORY_SCORE_THRESHOLD  as MIN_SIMILARITY_THRESHOLD,
  MEMORY_TIME_GAP_MS      as TIME_GAP_THRESHOLD_MS,
  MEMORY_RAG_CUTOFF_MS    as RAG_CUTOFF_MS,
  MEMORY_MAX_INLINE_CTX   as MAX_INLINE_CONTEXT_SIZE
} from './config.js';

const logger = Logger.get('MemorySystem');

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
    if (CACHE_ENABLED) {
      await redisCache.connect();
    }
    // C-5: restore persisted indexing state so restarts don't re-index everything
    await memoryStore.loadIndexedCounts();
  }

  /** @see MemoryStore.addPersonalData */
  addPersonalData(userId, fact) {
    return memoryStore.addPersonalData(userId, fact);
  }

  /** @see MemoryStore.removePersonalData */
  removePersonalData(userId, factKeyword) {
    return memoryStore.removePersonalData(userId, factKeyword);
  }

  /** @see MemoryStore.getUserPersonalData */
  getUserPersonalData(userId) {
    return memoryStore.getUserPersonalData(userId);
  }

  /** @see MemoryStore.invalidatePersonalDataCache */
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
   * Search memory — looks in BOTH vector RAG memories AND stored user facts,
   * merges results by relevance, and deduplicates.
   * 
   * Called by the `search_memory` function tool. Returns a flat array of strings
   * ready to be joined and returned to the LLM.
   *
   * @param {string}      userId
   * @param {string|null} guildId
   * @param {string}      historyId  - Correct historyId from the calling context
   * @param {string}      query
   * @returns {Promise<string[]>}
   */
  async searchMemory(userId, guildId, historyId, query) {
    if (!query?.trim()) return [];

    try {
      const searchId   = historyId || guildId || userId;
      const queryLower = query.toLowerCase();
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

      // ── 1. Vector RAG search ─────────────────────────────────────────────
      let ragResults = [];
      const queryEmbedding = await embeddingService.generateEmbedding(query, 'RETRIEVAL_QUERY');

      if (queryEmbedding) {
        // Try cache first, fall back to direct DB search
        let dbResults = null;

        if (CACHE_ENABLED) {
          const exact = memoryCache.getCachedQueryResults(searchId, query, userId, guildId);
          if (exact) {
            dbResults = exact;
          } else {
            const semantic = memoryCache.getSemanticallyCachedResults(searchId, queryEmbedding, userId, guildId);
            if (semantic) dbResults = semantic;
          }
        }

        if (!dbResults) {
          const raw = CACHE_ENABLED
            ? await clusterEngine.clusterSearch(searchId, queryEmbedding, 0)
            : await db.findSimilarMemories(searchId, queryEmbedding, MAX_RAG_RESULTS * 3);

          dbResults = (raw || []).filter(e => (e.score ?? 0) >= MIN_SIMILARITY_THRESHOLD);
          if (CACHE_ENABLED && dbResults.length) {
            memoryCache.cacheQueryResults(searchId, query, dbResults, userId, guildId, queryEmbedding);
          }
        }

        ragResults = (dbResults || [])
          .slice(0, MAX_RAG_RESULTS)
          .map(entry => {
            const text = entry.messages
              ?.map(m => extractTextFromMessage(m))
              .filter(t => t.length > 0)
              .join(' ')
              .slice(0, 400)
              || extractTextFromMessage({ content: entry.messages?.[0]?.content });
            return {
              type:  'memory',
              text:  text.trim(),
              score: entry.score ?? 0,
              ts:    entry.timestamp ?? 0
            };
          })
          .filter(r => r.text.length > 5);
      }

      // ── 2. User facts search (always runs — zero embedding cost) ─────────
      const [userFacts, personalData] = await Promise.all([
        db.getUserFacts(userId).catch(() => []),
        memoryStore.getUserPersonalData(userId).catch(() => null)
      ]);

      // Score facts by query-word overlap
      const factResults = (userFacts || [])
        .map(fact => {
          const fl    = fact.toLowerCase();
          const hits  = queryWords.filter(w => fl.includes(w)).length;
          const score = queryWords.length > 0 ? hits / queryWords.length : 0;
          return { type: 'fact', text: fact, score, ts: 0 };
        })
        .filter(r => r.score > 0);

      // Also check personal data blob (timezone, birthday, reminders, etc.)
      const personalResults = [];
      if (personalData?.text) {
        const pl   = personalData.text.toLowerCase();
        const hits = queryWords.filter(w => pl.includes(w)).length;
        if (hits > 0 && queryWords.length > 0) {
          const score = hits / queryWords.length;
          // Extract only the relevant lines from the personal data block
          const relevantLines = personalData.text
            .split('\n')
            .filter(line => queryWords.some(w => line.toLowerCase().includes(w)))
            .slice(0, 3);
          if (relevantLines.length > 0) {
            personalResults.push({ type: 'personal', text: relevantLines.join('\n'), score, ts: 0 });
          }
        }
      }

      // ── 3. Merge, deduplicate, sort by score ──────────────────────────────
      const all = [...ragResults, ...factResults, ...personalResults];
      all.sort((a, b) => b.score - a.score);

      // Deduplicate by text similarity (skip if > 80% of words overlap with a prior result)
      const seen   = [];
      const unique = [];
      for (const r of all) {
        const rWords = new Set(r.text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        const isDup  = seen.some(prev => {
          const pWords = new Set(prev.toLowerCase().split(/\s+/).filter(w => w.length > 3));
          if (pWords.size === 0) return false;
          const overlap = [...rWords].filter(w => pWords.has(w)).length;
          return overlap / pWords.size > 0.8;
        });
        if (!isDup) {
          unique.push(r);
          seen.push(r.text);
        }
      }

      // ── 4. Format output strings for the LLM ─────────────────────────────
      return unique.map(r => {
        const label = r.type === 'fact'     ? '[Stored Fact]'
                    : r.type === 'personal' ? '[Personal Info]'
                    :                         '[Conversation Memory]';
        return `${label} ${r.text}`;
      });

    } catch (error) {
      logger.error('searchMemory failed', error);
      return [];
    }
  }

  // ==========================================================================
  // RAG CONTEXT RETRIEVAL
  // ==========================================================================

  /**
   * Retrieve relevant historical context for the current query via RAG.
   *
   * @param {string}      historyId
   * @param {string}      currentQuery
   * @param {number[]}    recentMessageTimestamps
   * @param {string|null} [userId]
   * @param {string|null} [guildId]
   * @returns {Promise<{ messages: object[], personalData: object|null, queryEmbedding: number[]|null }>}
   */
  async getRelevantContext(historyId, currentQuery, recentMessageTimestamps, userId = null, guildId = null) {
    try {
      if (!currentQuery?.trim()) return { messages: [], personalData: null, queryEmbedding: null };

      if (!CACHE_ENABLED) {
        return await this._directVectorSearch(
          historyId, currentQuery, recentMessageTimestamps, userId, guildId
        );
      }

      // ── L1: Exact in-memory hit ───────────────────────────────────────────
      const exactCached = memoryCache.getCachedQueryResults(historyId, currentQuery, userId, guildId);
      if (exactCached) {
        const personalData = userId ? await memoryStore.getUserPersonalData(userId) : null;
        return { messages: exactCached, personalData, queryEmbedding: null };
      }

      const [queryEmbedding, personalData] = await Promise.all([
        embeddingService.generateEmbedding(currentQuery, 'RETRIEVAL_QUERY'),
        userId ? memoryStore.getUserPersonalData(userId) : Promise.resolve(null)
      ]);

      if (!queryEmbedding) return { messages: [], personalData, queryEmbedding: null };

      // ── L2: Semantic in-memory hit ────────────────────────────────────────
      const semanticCached = memoryCache.getSemanticallyCachedResults(historyId, queryEmbedding, userId, guildId);
      if (semanticCached) return { messages: semanticCached, personalData, queryEmbedding };

      // ── L3: Redis hit ─────────────────────────────────────────────────────
      const queryHash   = memoryCache.generateQueryHash(historyId, currentQuery, userId, guildId);
      const redisCached = await redisCache.get(historyId, queryHash);
      if (redisCached) {
        memoryCache.cacheQueryResults(historyId, currentQuery, redisCached, userId, guildId, queryEmbedding);
        return { messages: redisCached, personalData, queryEmbedding };
      }

      // ── L4: ClusterEngine + Atlas full RAG ───────────────────────────────
      // H-4 fix: use RAG_CUTOFF_MS (5 min) for dedup, not TIME_GAP_THRESHOLD_MS (30s)
      const maxTs = recentMessageTimestamps.length
        ? recentMessageTimestamps.reduce((a, b) => Math.max(a, b))
        : Date.now();
      const cutoffTimestamp = maxTs - RAG_CUTOFF_MS;

      const crossContextEnabled = userId
        ? (state.userSettings?.[userId]?.crossContextEnabled ?? false)
        : false;

      const searchPromises = [
        clusterEngine.clusterSearch(historyId, queryEmbedding, cutoffTimestamp)
      ];

      if (crossContextEnabled && userId) {
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
        if (userId && guildId && historyId !== guildId) {
          searchPromises.push(
            db.findSimilarMemoriesWithFilter(guildId, queryEmbedding, 1, { userId })
              .then(results => (results || [])
                .filter(e => (e.timestamp || 0) < cutoffTimestamp && e.score >= MIN_SIMILARITY_THRESHOLD)
                .map(e => ({ messages: e.messages, score: e.score * 0.85, source: 'server-context', timestamp: e.timestamp }))
              ).catch(() => [])
          );
        }
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

      memoryCache.cacheQueryResults(historyId, currentQuery, topResults, userId, guildId, queryEmbedding);
      redisCache.set(historyId, queryHash, topResults);

      return { messages: topResults, personalData, queryEmbedding };

    } catch (error) {
      logger.error('Context retrieval failed', error);
      return { messages: [], personalData: null, queryEmbedding: null };
    }
  }

  /**
   * Direct MongoDB Atlas $vectorSearch — the CACHE_ENABLED=false fast path.
   * @private
   */
  async _directVectorSearch(historyId, currentQuery, recentMessageTimestamps, userId, guildId) {
    // H-4 + M-3 fix: use RAG_CUTOFF_MS and guard against empty array
    const maxTs = recentMessageTimestamps.length
      ? recentMessageTimestamps.reduce((a, b) => Math.max(a, b))
      : Date.now();
    const cutoffTimestamp = maxTs - RAG_CUTOFF_MS;

    const crossContextEnabled = userId
      ? (state.userSettings?.[userId]?.crossContextEnabled ?? false)
      : false;

    const [queryEmbedding, personalData] = await Promise.all([
      embeddingService.generateEmbedding(currentQuery, 'RETRIEVAL_QUERY'),
      userId ? memoryStore.getUserPersonalData(userId) : Promise.resolve(null)
    ]);

    if (!queryEmbedding) return { messages: [], personalData, queryEmbedding: null };

    const searchPromises = [
      db.findSimilarMemories(historyId, queryEmbedding, MAX_RAG_RESULTS * 2)
        .then(results => (results || [])
          .filter(e => (e.timestamp || 0) < cutoffTimestamp && e.score >= MIN_SIMILARITY_THRESHOLD)
          .map(e => ({ messages: e.messages, score: e.score, source: 'conversation-history', timestamp: e.timestamp }))
        ).catch(() => [])
    ];

    if (crossContextEnabled && userId) {
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
      if (userId && guildId && historyId !== guildId) {
        searchPromises.push(
          db.findSimilarMemoriesWithFilter(guildId, queryEmbedding, 1, { userId })
            .then(results => (results || [])
              .filter(e => (e.timestamp || 0) < cutoffTimestamp && e.score >= MIN_SIMILARITY_THRESHOLD)
              .map(e => ({ messages: e.messages, score: e.score * 0.85, source: 'server-context', timestamp: e.timestamp }))
            ).catch(() => [])
        );
      }
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
    return { messages: allResults.slice(0, MAX_RAG_RESULTS), personalData, queryEmbedding };
  }

  // ==========================================================================
  // MAIN ENTRY POINT
  // ==========================================================================

  /**
   * Get the fully optimised conversation history for the Gemini API.
   *
   * @param {string}      historyId
   * @param {string}      currentQuery
   * @param {string}      model
   * @param {string|null} [userId]
   * @param {string|null} [guildId]
   * @returns {Promise<object[]>}
   */
  async getOptimizedHistory(historyId, currentQuery, model, userId = null, guildId = null) {
    try {
      const allHistory = await db.getChatHistory(historyId);
      if (!allHistory) return [];

      // M-6: avoid O(n²) push spread — iterate instead
      const historyArray = [];
      for (const key of Object.keys(allHistory)) {
        const msgs = allHistory[key];
        if (Array.isArray(msgs)) {
          for (const m of msgs) historyArray.push(m);
        }
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

      // H-2 fix: inject personal data even when RAG is disabled
      if (!ENABLE_RAG) {
        const personal = userId ? await memoryStore.getUserPersonalData(userId) : null;
        const formatted = this.formatHistoryForAPI(recentMessages);
        if (personal?.text) {
          const personalBlock = { role: 'user', parts: [{ text: `[Your Stored Profile]\n${personal.text}` }] };
          const bridge = [{ role: 'model', parts: [{ text: '[Profile noted]' }] }];
          return [...formatted, ...bridge, personalBlock, { role: 'model', parts: [{ text: '[Noted]' }] }];
        }
        return formatted;
      }

      // RAG enabled path
      const ragResults = await this.getRelevantContext(
        historyId, currentQuery, recentTimestamps, userId, guildId
      );
      const { messages: relevantMemories, personalData, queryEmbedding } = ragResults;

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

      // C-1 Step 3 / H-2: lower personal data similarity gate from 0.3 → 0.15
      if (personalData?.embedding && queryEmbedding) {
        const sim = embeddingService.cosineSimilarity(queryEmbedding, personalData.embedding);
        if (sim >= 0.15) {
          contextSections.push({
            type:      'personal-data',
            content:   personalData.text,
            score:     sim,
            timestamp: Date.now()
          });
        }
      } else if (personalData?.text) {
        // Include personal data even without similarity check when no queryEmbedding
        contextSections.push({
          type:      'personal-data',
          content:   personalData.text,
          timestamp: Date.now()
        });
      }

      const formattedContext = this.buildContextMessage(contextSections);
      const formattedRecent  = this.formatHistoryForAPI(recentMessages);

      if (!formattedContext) return formattedRecent;

      const needsBridge = formattedRecent.length > 0 && formattedRecent[0].role === 'user';
      const bridge = needsBridge
        ? [{ role: 'model', parts: [{ text: '[Context noted]' }] }]
        : [];

      return [formattedContext, ...bridge, ...formattedRecent];

    } catch (error) {
      logger.error('History optimization failed', error);
      // H-10 fix: fall back to in-memory state rather than returning empty
      try {
        const fallback = state.chatHistories?.[historyId];
        if (fallback) {
          const msgs = [];
          for (const key of Object.keys(fallback)) {
            const entries = fallback[key];
            if (Array.isArray(entries)) {
              for (const m of entries) msgs.push(m);
            }
          }
          if (msgs.length > 0) {
            msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            return this.formatHistoryForAPI(msgs.slice(-RECENT_MESSAGE_WINDOW));
          }
        }
      } catch { /* swallow fallback errors */ }
      return [];
    }
  }

  // ==========================================================================
  // FORMATTING UTILITIES
  // ==========================================================================

  /**
   * Build a single Gemini `contents` entry from context sections.
   * H-5 fix: truncates gracefully instead of returning null when over the limit.
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

    // H-5 fix: truncate gracefully instead of silently dropping the whole block
    if (text.length > MAX_INLINE_CONTEXT_SIZE) {
      const truncated = text.slice(0, MAX_INLINE_CONTEXT_SIZE - 60) +
        '\n\n[...context truncated for length]';
      return { role: 'user', parts: [{ text: truncated.trim() }] };
    }

    return { role: 'user', parts: [{ text: text.trim() }] };
  }

  /**
   * Human-readable label for a context section type.
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

      // L-12 fix: only set userInfoAdded after a real text part is processed
      let userInfoAdded = false;
      for (const part of (entry.content || entry.parts || [])) {
        if (part.text !== undefined && part.text !== '') {
          let text = part.text;
          // L-12 fix: prefix username only on the first real text part
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

      // M-14 fix: preserve media-only messages with a placeholder so alternation isn't broken
      if (apiEntry.parts.length === 0) {
        apiEntry.parts.push({ text: '[media-only message]' });
      }

      formatted.push(apiEntry);
    }

    return this.sanitizeHistory(formatted);
  }

  /**
   * Enforce strict user→model alternation required by the Gemini API.
   * M-8 fix: only drop trailing user entry if history has more than 1 entry.
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

    // M-8 fix: only pop trailing user if length > 1 (avoids emptying 2-entry histories)
    if (merged.length > 1 && merged[merged.length - 1].role === 'user') merged.pop();

    return merged;
  }

  // ==========================================================================
  // STATUS & DEBUG
  // ==========================================================================

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
        ragCutoff:            '5min',
        backgroundClustering: CACHE_ENABLED ? 'enabled' : 'disabled',
        redisCache:           CACHE_ENABLED ? (redisCache.isAvailable ? 'connected' : 'disconnected') : 'disabled'
      },
      entries: Array.from(memoryStore.lastIndexedCount.entries()).map(([id, count]) => ({
        historyId:               id,
        lastIndexedMessageCount: count
      }))
    };
  }

  clearAllCaches() {
    embeddingService.clearCache();
    memoryCache.clearCache();
    clusterEngine.clearCache();
    memoryStore.clearCache();
    return { success: true, message: 'All caches cleared' };
  }
}

// ============================================================================
// EXPORT SINGLETON
// ============================================================================

export const memorySystem = new MemorySystem();
