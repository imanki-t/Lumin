/**
 * @fileoverview Query result cache for memory retrieval deduplication.
 *               Prevents redundant embedding + DB calls for identical queries
 *               within a short time window.
 * @module memory/MemoryCache
 */

import crypto from 'crypto';

// ============================================================================
// CONSTANTS
// ============================================================================

const QUERY_CACHE_TTL_MS         = 2 * 60 * 1000; // 2 minutes
const MAX_QUERY_CACHE_SIZE       = 200;
const MIN_QUERY_LENGTH_FOR_CACHE = 10;

/**
 * Cosine similarity threshold for semantic cache hits.
 * Queries scoring >= this value against a cached query embedding are treated
 * as equivalent and return the cached result without hitting the DB.
 * 0.92 is tight enough to avoid false positives (e.g. "my dog" vs "my cat")
 * while catching rephrased duplicates ("what did I say about X" vs "tell me about X").
 */
const SEMANTIC_SIMILARITY_THRESHOLD = 0.92;

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

    const now = Date.now();

    for (const [hash, entry] of this.queryCache.entries()) {
      // Only consider entries for the same history/user/guild context
      if (entry.historyId !== historyId) continue;
      if (entry.userId !== (userId ?? '') || entry.guildId !== (guildId ?? '')) continue;

      // Evict expired entries opportunistically during scan
      if (now - entry.timestamp > QUERY_CACHE_TTL_MS) {
        this.queryCache.delete(hash);
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

    // LRU eviction — Map preserves insertion order
    if (this.queryCache.size > MAX_QUERY_CACHE_SIZE) {
      this.queryCache.delete(this.queryCache.keys().next().value);
    }
  }

  /**
   * Invalidate all cached results for a given historyId.
   * Call this after new memories are stored for that history.
   *
   * @param {string} historyId
   */
  invalidateQueryCache(historyId) {
    for (const [hash, data] of this.queryCache.entries()) {
      if (data.historyId === historyId) this.queryCache.delete(hash);
    }
  }

  /** Clear the entire query cache. */
  clearCache() {
    this.queryCache.clear();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const memoryCache = new MemoryCache();
