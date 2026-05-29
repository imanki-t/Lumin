/**
 * @fileoverview Query result cache for memory retrieval deduplication.
 *               Prevents redundant embedding + DB calls for identical queries
 *               within a short time window.
 * @module memory/MemoryCache
 */

import crypto from 'crypto';
import {
  MEMORY_CACHE_TTL_MS        as QUERY_CACHE_TTL_MS,
  MEMORY_CACHE_MAX_SIZE      as MAX_QUERY_CACHE_SIZE,
  MEMORY_CACHE_MIN_QUERY_LEN as MIN_QUERY_LENGTH_FOR_CACHE,
  MEMORY_CACHE_SEMANTIC_SIM  as SEMANTIC_SIMILARITY_THRESHOLD
} from './config.js';

// ============================================================================
// MEMORY CACHE
// ============================================================================

class MemoryCache {
  constructor() {
    /**
     * @type {Map<string, { results: object[], timestamp: number, historyId: string, queryEmbedding: number[]|null }>}
     * queryHash → cached retrieval result + embedding for semantic lookup
     */
    this.queryCache = new Map();
    /**
     * M-7 fix: secondary index so getSemanticallyCachedResults only scans
     * entries for the relevant historyId instead of all 200 entries.
     * @type {Map<string, Set<string>>} historyId → Set of queryHash keys
     */
    this.byHistoryId = new Map();
  }

  // ── Cosine similarity (inline — avoids circular import with EmbeddingService) ──

  /**
   * Cosine similarity between two equal-length vectors.
   * Kept private — only used for semantic cache lookups.
   *
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number} 0–1
   */
  _cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na  += a[i] * a[i];
      nb  += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }

  // ── Query cache ───────────────────────────────────────────────────────────

  /**
   * Generate a deterministic MD5 hash for a (historyId, query, userId, guildId) tuple.
   *
   * @param {string}      historyId
   * @param {string}      query
   * @param {string|null} userId
   * @param {string|null} guildId
   * @returns {string}
   */
  generateQueryHash(historyId, query, userId = null, guildId = null) {
    const input = `${historyId}:${query}:${userId ?? ''}:${guildId ?? ''}`;
    return crypto.createHash('md5').update(input).digest('hex');
  }

  /**
   * Return cached query results if present and not expired.
   * Short queries (< MIN_QUERY_LENGTH_FOR_CACHE) are never cached.
   *
   * @param {string}      historyId
   * @param {string}      query
   * @param {string|null} [userId]
   * @param {string|null} [guildId]
   * @returns {object[]|null}
   */
  getCachedQueryResults(historyId, query, userId = null, guildId = null) {
    if (!query || query.length < MIN_QUERY_LENGTH_FOR_CACHE) return null;

    const hash   = this.generateQueryHash(historyId, query, userId, guildId);
    const cached = this.queryCache.get(hash);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > QUERY_CACHE_TTL_MS) {
      this.queryCache.delete(hash);
      return null;
    }

    return cached.results;
  }

  /**
   * Semantic cache lookup — checks if any cached query for this history is
   * semantically equivalent to the given embedding (cosine similarity ≥ threshold).
   *
   * Called AFTER the query embedding has already been generated (which is needed
   * for the vector search anyway), so this adds zero extra API calls.
   * On a hit it saves the entire clusterSearch + DB round trip.
   *
   * Only scans entries for the same historyId — never cross-contaminates results
   * between different users/channels.
   *
   * @param {string}      historyId
   * @param {number[]}    queryEmbedding  - Already-generated query vector
   * @param {string|null} [userId]
   * @param {string|null} [guildId]
   * @returns {object[]|null}
   */
  getSemanticallyCachedResults(historyId, queryEmbedding, userId = null, guildId = null) {
    if (!queryEmbedding?.length) return null;

    // M-7 fix: only scan entries for this historyId instead of all 200
    const candidates = this.byHistoryId.get(historyId);
    if (!candidates?.size) return null;

    const now = Date.now();

    for (const hash of candidates) {
      const entry = this.queryCache.get(hash);
      if (!entry) {
        candidates.delete(hash); // clean up stale reference
        continue;
      }

      if (entry.userId !== (userId ?? '') || entry.guildId !== (guildId ?? '')) continue;

      // Evict expired entries opportunistically
      if (now - entry.timestamp > QUERY_CACHE_TTL_MS) {
        this.queryCache.delete(hash);
        candidates.delete(hash);
        if (candidates.size === 0) this.byHistoryId.delete(historyId);
        continue;
      }

      if (!entry.queryEmbedding) continue;

      const similarity = this._cosineSimilarity(queryEmbedding, entry.queryEmbedding);
      if (similarity >= SEMANTIC_SIMILARITY_THRESHOLD) {
        return entry.results;
      }
    }

    return null;
  }

  /**
   * Store query results in the cache.
   * No-op for queries shorter than MIN_QUERY_LENGTH_FOR_CACHE.
   *
   * @param {string}      historyId
   * @param {string}      query
   * @param {object[]}    results
   * @param {string|null} [userId]
   * @param {string|null} [guildId]
   * @param {number[]|null} [queryEmbedding]  - Store alongside results for semantic lookup
   */
  cacheQueryResults(historyId, query, results, userId = null, guildId = null, queryEmbedding = null) {
    if (!query || query.length < MIN_QUERY_LENGTH_FOR_CACHE) return;

    const hash = this.generateQueryHash(historyId, query, userId, guildId);
    this.queryCache.set(hash, {
      results,
      timestamp:      Date.now(),
      historyId,
      userId:         userId  ?? '',
      guildId:        guildId ?? '',
      queryEmbedding: queryEmbedding ?? null
    });

    // M-7: maintain historyId index for O(k) semantic scan where k = entries for this history
    if (!this.byHistoryId.has(historyId)) this.byHistoryId.set(historyId, new Set());
    this.byHistoryId.get(historyId).add(hash);

    // LRU eviction — Map preserves insertion order
    if (this.queryCache.size > MAX_QUERY_CACHE_SIZE) {
      const oldest = this.queryCache.keys().next().value;
      const oldEntry = this.queryCache.get(oldest);
      this.queryCache.delete(oldest);
      // Remove from byHistoryId index
      if (oldEntry?.historyId) {
        const set = this.byHistoryId.get(oldEntry.historyId);
        if (set) {
          set.delete(oldest);
          if (set.size === 0) this.byHistoryId.delete(oldEntry.historyId);
        }
      }
    }
  }

  /**
   * Invalidate all cached results for a given historyId.
   * Call this after new memories are stored for that history.
   *
   * @param {string} historyId
   */
  invalidateQueryCache(historyId) {
    const hashes = this.byHistoryId.get(historyId);
    if (hashes) {
      for (const hash of hashes) this.queryCache.delete(hash);
      this.byHistoryId.delete(historyId);
    }
  }

  /** Clear the entire query cache. */
  clearCache() {
    this.queryCache.clear();
    this.byHistoryId.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const memoryCache = new MemoryCache();
